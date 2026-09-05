/**
 * MYRAA character engine — PMX stage.
 *
 * Loads the Evelyn PMX model with mmd-parser, builds the skinned mesh and
 * bone hierarchy, applies per-role material tuning, and drives the observable
 * behavior: idle breathing / sway / blinking / saccades, pointer eye tracking,
 * audio-driven lip sync, and camera orbit controls (WASD orbit, Q/E zoom,
 * F eye tracking, L camera lock).
 *
 * Material shading is an equivalent three.js implementation of the reference
 * tuning values (see docs/MYRAA-RECONSTRUCTION.md, APPROXIMATED section).
 */
import * as THREE from "three";
import * as MMDParser from "mmd-parser";
import type { EvelynConfig } from "./config";

/** Parsed PMX document (bones, morphs, materials, vertices). */
export type PmxData = ReturnType<InstanceType<typeof MMDParser.Parser>["parsePmx"]>;

export interface CharacterActivity {
  mode: "idle" | "listening" | "thinking" | "talking";
}

type ProgressCallback = (stage: string, ratio: number) => void;

const TEXTURE_LOADER_CACHE = new Map<string, THREE.Texture>();

function loadTexture(url: string): THREE.Texture | null {
  if (!url) return null;
  const cached = TEXTURE_LOADER_CACHE.get(url);
  if (cached) return cached;
  try {
    const texture = new THREE.TextureLoader().load(url);
    texture.colorSpace = THREE.SRGBColorSpace;
    TEXTURE_LOADER_CACHE.set(url, texture);
    return texture;
  } catch {
    return null;
  }
}

function hexColor(value: number): THREE.Color {
  return new THREE.Color(value);
}

interface PmxBone {
  name: string;
  englishName: string;
  position: number[];
  parentIndex: number;
  flag: number;
  connectIndex: number;
}

interface PmxMorph {
  name: string;
  englishName: string;
  type: number;
  elements: Array<{ index: number; position: number[] }>;
}

interface PmxMaterialLike {
  name: string;
  englishName?: string;
  diffuse: number[];
  specular?: number[];
  shininess?: number;
  ambient?: number[];
  flag?: number;
  edgeColor?: number[];
  edgeSize?: number;
  textureIndex: number;
  envTextureIndex: number;
  envFlag: number;
  toonFlag: number;
  toonIndex: number;
  faceCount: number;
}

export class MyraaCharacterStage {
  private readonly canvas: HTMLCanvasElement;
  private readonly config: EvelynConfig;
  private readonly onProgress: ProgressCallback;
  private readonly onError: (error: Error) => void;

  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera | null = null;
  private clock = new THREE.Clock();
  private model: THREE.SkinnedMesh | null = null;
  private skeleton: THREE.Skeleton | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private bones = new Map<string, THREE.Bone>();
  private morphIndex = new Map<string, number>();
  private running = false;
  private disposed = false;
  private frameHandle: number | null = null;
  private desiredSize = { width: 0, height: 0 };

  // Behaviour state
  private pointer = new THREE.Vector2(0, 0);
  private eyeTracking = true;
  private cameraLocked = false;
  private orbitYaw = 0;
  private orbitPitch = 0;
  private zoomDelta = 0;
  private keys = new Set<string>();
  private lastKeyTime = performance.now();
  private nextBlinkAt = 0;
  private nextSaccadeAt = 0;
  private nextPostureAt = 0;
  private blinkValue = 0;
  private blinkTarget = 0;
  private doubleBlinkQueued = false;
  private saccade = new THREE.Vector2(0, 0);
  private visemeWeights = [0, 0, 0, 0, 0];
  private mouthLevel = 0;
  private outputAnalyser: AnalyserNode | null = null;
  private activity: CharacterActivity = { mode: "idle" };
  private baseRotations = new Map<THREE.Bone, THREE.Quaternion>();

  constructor(options: {
    canvas: HTMLCanvasElement;
    config: EvelynConfig;
    onProgress: ProgressCallback;
    onError: (error: Error) => void;
  }) {
    this.canvas = options.canvas;
    this.config = options.config;
    this.onProgress = options.onProgress;
    this.onError = options.onError;
  }

  // ---------------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------------
  async load(): Promise<void> {
    const config = this.config;
    this.onProgress("Fetching model", 0.05);

    const [modelBuffer, textureMapRaw] = await Promise.all([
      fetch(config.modelUrl).then((response) => {
        if (!response.ok) throw new Error(`Failed to fetch model (${response.status}).`);
        return response.arrayBuffer();
      }),
      fetch(config.textureMapUrl)
        .then((response) => response.json())
        .catch(() => ({})),
    ]);

    this.onProgress("Parsing model", 0.22);
    const parser = new MMDParser.Parser();
    let pmx: PmxData;
    try {
      pmx = parser.parsePmx(modelBuffer);
    } catch (error) {
      throw new Error(`The character model could not be parsed: ${String(error)}`);
    }

    this.setupRenderer();
    this.onProgress("Building geometry", 0.38);
    const geometry = this.buildGeometry(pmx);

    this.onProgress("Building skeleton", 0.55);
    const { skeleton, bones } = this.buildSkeleton(pmx);
    this.skeleton = skeleton;
    this.bones = bones;

    this.onProgress("Building morphs", 0.72);
    this.buildMorphs(pmx, geometry);

    this.onProgress("Loading textures", 0.8);
    const modelDir = this.config.modelUrl.replace(/model\.pmx$/, "");
    const materials = this.buildMaterials(pmx, modelDir, textureMapRaw);

    // PMX materials occupy contiguous face ranges in the index buffer; expose
    // them as geometry groups so the multi-material SkinnedMesh renders all
    // 31 slots (skin, hair, clothes, eyes...) instead of only the first.
    let faceOffset = 0;
    (pmx.materials as unknown as PmxMaterialLike[]).forEach((material, materialIndex) => {
      const count = Number(material.faceCount) || 0;
      if (count > 0) geometry.addGroup(faceOffset * 3, count * 3, materialIndex);
      faceOffset += count;
    });

    const mesh = new THREE.SkinnedMesh(geometry, materials);
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    mesh.bind(skeleton);
    mesh.scale.setScalar(config.scale);
    // Named morph lookup for blinking / lip sync (matches this.morphIndex).
    mesh.morphTargetDictionary = Object.fromEntries(this.morphIndex);
    this.model = mesh;
    this.scene.add(mesh);

    this.onProgress("Baking ambient occlusion", 0.86);
    this.applyBasePose();

    this.onProgress("Reading physics", 0.92);
    // Spring-damper accessory dynamics are folded into the idle sway; the
    // pmx rigid-body simulation is intentionally not run headless.
    this.onProgress("Materializing presence links", 0.98);

    this.setupLights();
    this.attachControls();
  }

  private resolveTextureUrl(
    textureIndex: number,
    pmx: PmxData,
    modelDir: string,
    textureMap: { model?: string; textures?: Record<string, string> },
  ): string {
    if (!Number.isInteger(textureIndex) || textureIndex < 0) return "";
    const table = (pmx as unknown as { textures?: string[] }).textures || [];
    const rawPath = table[textureIndex];
    if (!rawPath) return "";
    const mapped = textureMap?.textures?.[rawPath];
    const relative = mapped || rawPath.replace(/\\/g, "/");
    return `${modelDir}${relative}`;
  }

  private setupRenderer() {
    const renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: this.config.render.antialias !== false,
      alpha: true,
      preserveDrawingBuffer: false,
    });
    renderer.setClearColor(0x000000, 0);
    const maxPixelRatio = Number(this.config.render.maxPixelRatio) || 2;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPixelRatio));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = Number(this.config.render.exposure) || 1;
    this.renderer = renderer;

    const fov = Number(this.config.camera.fov) || 30;
    this.camera = new THREE.PerspectiveCamera(fov, 1, 0.5, 400);
    this.camera.position.set(0, 22, Number(this.config.camera.distance) || 22);
    this.camera.lookAt(0, Number(this.config.camera.targetOffset) || 1.2, 0);

    // Apply any viewport size that was requested before the renderer existed.
    const pending = this.desiredSize;
    const fallback = this.canvas.parentElement;
    const width = pending.width || fallback?.clientWidth || this.canvas.clientWidth || 1280;
    const height = pending.height || fallback?.clientHeight || this.canvas.clientHeight || 577;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private buildGeometry(pmx: PmxData): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    const vertices = pmx.vertices as Array<{
      position: number[];
      normal: number[];
      uv: number[];
      skinWeights: number[];
      skinIndices: number[];
    }>;
    const positions = new Float32Array(vertices.length * 3);
    const normals = new Float32Array(vertices.length * 3);
    const uvs = new Float32Array(vertices.length * 2);
    const skinIndices = new Uint16Array(vertices.length * 4);
    const skinWeights = new Float32Array(vertices.length * 4);

    vertices.forEach((vertex, index) => {
      const p = vertex.position;
      // MMD uses a left-handed Y-up system; flip Z to convert to three.js.
      positions[index * 3 + 0] = p[0];
      positions[index * 3 + 1] = p[1];
      positions[index * 3 + 2] = -p[2];
      const n = vertex.normal;
      normals[index * 3 + 0] = n[0];
      normals[index * 3 + 1] = n[1];
      normals[index * 3 + 2] = -n[2];
      uvs[index * 2 + 0] = vertex.uv[0];
      uvs[index * 2 + 1] = 1 - vertex.uv[1];

      const weights = vertex.skinWeights || [];
      const indices = vertex.skinIndices || [];
      for (let slot = 0; slot < 4; slot += 1) {
        skinIndices[index * 4 + slot] = indices[slot] || 0;
        skinWeights[index * 4 + slot] = weights[slot] ?? (slot === 0 ? 1 : 0);
      }
    });

    const indices: number[] = [];
    // mmd-parser returns faces as a flat list of { indices: [a, b, c] } —
    // NOT number[][]. Reverse the winding for the Z-flip (handedness change).
    for (const face of pmx.faces as unknown as Array<{ indices: number[] }>) {
      const f = face.indices;
      if (!f || f.length < 3) continue;
      indices.push(f[0], f[2], f[1]);
    }

    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geometry.setAttribute("skinIndex", new THREE.BufferAttribute(skinIndices, 4));
    geometry.setAttribute("skinWeight", new THREE.BufferAttribute(skinWeights, 4));
    geometry.setIndex(indices);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }

  private buildSkeleton(pmx: PmxData): {
    skeleton: THREE.Skeleton;
    bones: Map<string, THREE.Bone>;
  } {
    const pmxBones = pmx.bones as unknown as PmxBone[];
    // PMX stores ABSOLUTE model-space positions for every bone; three.js bones
    // need positions RELATIVE to their parent. Convert with a consistent Z flip
    // (MMD left-handed Y-up → three.js right-handed).
    const absolute = pmxBones.map((bone) => (
      new THREE.Vector3(bone.position[0], bone.position[1], -bone.position[2])
    ));
    const created: THREE.Bone[] = pmxBones.map((bone, index) => {
      const threeBone = new THREE.Bone();
      threeBone.name = bone.name;
      const parent = bone.parentIndex >= 0 ? pmxBones[bone.parentIndex] : null;
      if (parent && bone.parentIndex !== index) {
        threeBone.position.copy(absolute[index]).sub(absolute[bone.parentIndex]);
      } else {
        threeBone.position.copy(absolute[index]);
      }
      return threeBone;
    });

    pmxBones.forEach((bone, index) => {
      if (bone.parentIndex >= 0 && bone.parentIndex !== index && created[bone.parentIndex]) {
        created[bone.parentIndex].add(created[index]);
      }
    });

    // Roots without parents attach to a shared origin holder.
    const rootHolder = new THREE.Bone();
    rootHolder.name = "MYRAA_ROOT_HOLDER";
    created.forEach((bone, index) => {
      if (pmxBones[index].parentIndex < 0) rootHolder.add(bone);
    });

    const named = new Map<string, THREE.Bone>();
    created.forEach((bone) => named.set(bone.name, bone));

    const rootBone = named.get(this.config.bones.root) || rootHolder;
    if (rootBone !== rootHolder && rootBone.parent !== rootHolder) rootHolder.add(rootBone);
    rootHolder.updateMatrixWorld(true);

    const skeleton = new THREE.Skeleton(created);
    return { skeleton, bones: named };
  }

  private buildMorphs(pmx: PmxData, geometry: THREE.BufferGeometry) {
    const morphs = (pmx.morphs || []) as unknown as PmxMorph[];
    const vertexMorphs = morphs.filter((morph) => morph.type === 1 && morph.elements?.length);
    if (!vertexMorphs.length) return;

    const elementCount = vertexMorphs.length;
    const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
    const basePositions = Float32Array.from(positions.array as Float32Array);
    const morphPositions = new Float32Array(elementCount * basePositions.length);

    vertexMorphs.forEach((morph, morphIndex) => {
      for (const element of morph.elements) {
        const vertexIndex = element.index;
        if (vertexIndex * 3 + 2 >= basePositions.length) continue;
        const offset = element.position;
        if (!offset) continue;
        morphPositions[morphIndex * basePositions.length + vertexIndex * 3 + 0] = offset[0];
        morphPositions[morphIndex * basePositions.length + vertexIndex * 3 + 1] = offset[1];
        morphPositions[morphIndex * basePositions.length + vertexIndex * 3 + 2] = -offset[2];
      }
      const name = morph.name || morph.englishName || `morph_${morphIndex}`;
      this.morphIndex.set(name, morphIndex);
    });

    // three.js expects ONE BufferAttribute PER morph target. PMX offsets are
    // relative to the base position, so mark morphTargetsRelative = true.
    // All targets share one Float32Array; each attribute is a typed-array view.
    const attributes: THREE.BufferAttribute[] = [];
    for (let target = 0; target < elementCount; target += 1) {
      const view = new Float32Array(
        morphPositions.buffer,
        target * basePositions.length * 4,
        basePositions.length,
      );
      attributes.push(new THREE.BufferAttribute(view, 3));
    }
    geometry.morphAttributes.position = attributes;
    geometry.morphTargetsRelative = true;
    void positions;
  }

  private roleForMaterial(name: string): string {
    const normalized = name.toLowerCase();
    for (const [role, patterns] of Object.entries(this.config.materialRoles)) {
      for (const pattern of patterns) {
        if (normalized.includes(pattern.toLowerCase())) return role;
      }
    }
    return "cloth";
  }

  private buildMaterials(
    pmx: PmxData,
    modelDir: string,
    textureMap: { model?: string; textures?: Record<string, string> },
  ): THREE.Material[] {
    const materials: THREE.Material[] = [];
    for (const material of pmx.materials as unknown as PmxMaterialLike[]) {
      const role = this.roleForMaterial(material.name);
      const tuning = this.config.materialTuning[role] || {};
      const diffuse = material.diffuse || [1, 1, 1, 1];
      const mapUrl = this.resolveTextureUrl(material.textureIndex, pmx, modelDir, textureMap);

      if (role === "catchlight") {
        const unlit = new THREE.MeshBasicMaterial({
          color: new THREE.Color(diffuse[0], diffuse[1], diffuse[2]),
          transparent: diffuse[3] < 1,
          opacity: diffuse[3],
        });
        unlit.name = material.name;
        materials.push(unlit);
        continue;
      }

      const standard = new THREE.MeshStandardMaterial({
        color: new THREE.Color(diffuse[0], diffuse[1], diffuse[2]),
        roughness: 1 - Math.min(0.9, Number(tuning.specularStrength ?? 0.06)),
        metalness: role === "metal" ? 0.85 : 0.02,
        transparent: diffuse[3] < 1,
        opacity: diffuse[3],
        emissive: role === "iris" ? new THREE.Color(0x1a1a22) : new THREE.Color(0x000000),
        emissiveIntensity: Number(tuning.emissiveStrength ?? 0),
      });
      if (mapUrl) {
        const texture = loadTexture(mapUrl);
        if (texture) standard.map = texture;
      }
      // Per-role visual modulation from the extracted tunings.
      if (typeof tuning.brightness === "number") {
        const brightness = Number(tuning.brightness);
        standard.color.multiplyScalar(brightness);
      }
      standard.name = material.name;
      materials.push(standard);
    }
    return materials;
  }

  private setupLights() {
    const lighting = this.config.lighting as Record<string, number | Record<string, number>>;
    const asColor = (value: number) => hexColor(value);

    const ambient = new THREE.HemisphereLight(
      asColor(lighting.ambientSkyColor as number),
      asColor(lighting.ambientGroundColor as number),
      lighting.ambientIntensity as number,
    );
    this.scene.add(ambient);

    const key = new THREE.DirectionalLight(asColor(lighting.keyColor as number), lighting.keyIntensity as number);
    key.position.setFromSphericalCoords(
      60,
      THREE.MathUtils.degToRad(90 - (lighting.keyElevation as number)),
      THREE.MathUtils.degToRad(lighting.keyAzimuth as number),
    );
    key.castShadow = true;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(asColor(lighting.fillColor as number), lighting.fillIntensity as number);
    fill.position.setFromSphericalCoords(
      60,
      THREE.MathUtils.degToRad(90 - (lighting.fillElevation as number)),
      THREE.MathUtils.degToRad(lighting.fillAzimuth as number),
    );
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight(asColor(lighting.rimColor as number), lighting.rimIntensity as number);
    rim.position.setFromSphericalCoords(
      60,
      THREE.MathUtils.degToRad(90 - (lighting.rimElevation as number)),
      THREE.MathUtils.degToRad(lighting.rimAzimuth as number),
    );
    this.scene.add(rim);

    const frontFill = new THREE.DirectionalLight(
      asColor(lighting.frontFillColor as number),
      lighting.frontFillIntensity as number,
    );
    frontFill.position.set(0, 8, 60);
    this.scene.add(frontFill);
  }

  private applyBasePose() {
    for (const [boneKey, rotation] of Object.entries(this.config.basePose)) {
      const bone = this.bones.get(this.config.bones[boneKey]);
      if (!bone) continue;
      bone.rotation.x += rotation.x ?? 0;
      bone.rotation.y += rotation.y ?? 0;
      bone.rotation.z += rotation.z ?? 0;
    }
    // Record rest rotations so procedural idle motion can be additive.
    this.baseRotations.clear();
    this.bones.forEach((bone) => {
      this.baseRotations.set(bone, bone.quaternion.clone());
    });
  }

  private attachControls() {
    window.addEventListener("pointermove", this.onPointerMove, { passive: true });
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  private onPointerMove = (event: PointerEvent) => {
    this.pointer.set(
      (event.clientX / window.innerWidth) * 2 - 1,
      -(event.clientY / window.innerHeight) * 2 - 1,
    );
  };

  private onKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
    const key = event.key.toLowerCase();
    this.keys.add(key);
    if (key === "f") this.eyeTracking = !this.eyeTracking;
    if (key === "l") this.cameraLocked = !this.cameraLocked;
    this.lastKeyTime = performance.now();
  };

  private onKeyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.key.toLowerCase());
  };

  // ---------------------------------------------------------------------------
  // Public behaviour API
  // ---------------------------------------------------------------------------
  setActivity(activity: CharacterActivity) {
    this.activity = activity;
  }

  setOutputAnalyser(analyser: AnalyserNode | null) {
    this.outputAnalyser = analyser;
  }

  setPointer(x: number, y: number) {
    this.pointer.set(x, y);
  }

  orbitBy(yaw: number, pitch: number) {
    this.orbitYaw += yaw;
    this.orbitPitch += pitch;
  }

  zoomBy(delta: number) {
    this.zoomDelta = delta;
  }

  resize(width: number, height: number) {
    // Remember the requested viewport: the renderer may not exist yet (resize
    // is called before load()), so apply it as soon as it is created.
    this.desiredSize.width = width;
    this.desiredSize.height = height;
    if (!this.renderer || !this.camera || width <= 0 || height <= 0) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  start() {
    if (this.running || this.disposed) return;
    this.running = true;
    this.nextBlinkAt = performance.now() + 2000;
    this.nextSaccadeAt = performance.now() + 1500;
    this.nextPostureAt = performance.now() + 9000;
    const loop = () => {
      if (!this.running || this.disposed) return;
      this.frameHandle = requestAnimationFrame(loop);
      this.tick();
    };
    this.frameHandle = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    if (this.frameHandle !== null) cancelAnimationFrame(this.frameHandle);
    this.frameHandle = null;
  }

  dispose() {
    this.disposed = true;
    this.stop();
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.model?.geometry.dispose();
    if (Array.isArray(this.model?.material)) {
      (this.model?.material as THREE.Material[]).forEach((material) => material.dispose());
    } else {
      (this.model?.material as THREE.Material | undefined)?.dispose();
    }
    this.renderer?.dispose();
    this.scene.clear();
  }

  // ---------------------------------------------------------------------------
  // Frame update
  // ---------------------------------------------------------------------------
  private tick() {
    const now = performance.now();
    const delta = Math.min(0.1, this.clock.getDelta());
    const idle = this.config.idle;
    const t = this.clock.elapsedTime;

    // --- Breathing (groove bone) ---
    const groove = this.bones.get(this.config.bones.groove);
    if (groove) {
      const breath = Math.sin(t * Math.PI * 2 * idle.breathRate) * 0.06 * idle.breathDepth;
      groove.position.y = (groove.userData.baseY ??= groove.position.y) + breath;
    }

    // --- Idle sway (center bone) ---
    const center = this.bones.get(this.config.bones.center);
    if (center) {
      const sway = Math.sin(t * Math.PI * 2 * idle.swayRate) * 0.018 * idle.swayAmount;
      center.rotation.z = (this.baseRotations.get(center)?.z ?? 0) + sway;
    }

    // --- Talking / thinking posture bias ---
    const upperBody = this.bones.get(this.config.bones.upperBody);
    if (upperBody) {
      const targetBias = this.activity.mode === "thinking" ? 0.05 : 0;
      upperBody.rotation.x = (this.baseRotations.get(upperBody)?.x ?? 0) + targetBias;
    }

    // --- Blinking ---
    if (now >= this.nextBlinkAt) {
      this.blinkTarget = 1;
      if (Math.random() < idle.doubleBlinkChance) this.doubleBlinkQueued = true;
      this.nextBlinkAt = now + (idle.blinkIntervalMin + Math.random() * (idle.blinkIntervalMax - idle.blinkIntervalMin)) * 1000;
    }
    this.blinkValue += (this.blinkTarget - this.blinkValue) * Math.min(1, delta * 14);
    if (this.blinkTarget === 1 && this.blinkValue > 0.96) this.blinkTarget = 0;
    if (this.blinkTarget === 0 && this.blinkValue < 0.04 && this.doubleBlinkQueued) {
      this.doubleBlinkQueued = false;
      this.blinkTarget = 1;
    }
    this.setMorph(this.config.morphs.blink, this.blinkValue);

    // --- Saccades (eye micro-movement) ---
    if (now >= this.nextSaccadeAt) {
      this.saccade.set((Math.random() - 0.5) * 0.35, (Math.random() - 0.5) * 0.2);
      this.nextSaccadeAt = now + (idle.saccadeIntervalMin + Math.random() * (idle.saccadeIntervalMax - idle.saccadeIntervalMin)) * 1000;
    }

    // --- Eye tracking ---
    const eyes = this.bones.get(this.config.bones.eyes);
    if (eyes) {
      const base = this.baseRotations.get(eyes);
      if (this.eyeTracking) {
        const targetYaw = this.pointer.x * 0.32 + this.saccade.x;
        const targetPitch = this.pointer.y * 0.18 + this.saccade.y;
        eyes.rotation.y += ((base?.y ?? 0) + targetYaw - eyes.rotation.y) * Math.min(1, delta * 8);
        eyes.rotation.x += ((base?.x ?? 0) + targetPitch - eyes.rotation.x) * Math.min(1, delta * 8);
      } else {
        eyes.rotation.y += (this.saccade.x - eyes.rotation.y) * Math.min(1, delta * 6);
        eyes.rotation.x += (this.saccade.y - eyes.rotation.x) * Math.min(1, delta * 6);
      }
    }

    // --- Lip sync ---
    this.updateLipSync(delta);

    // --- Occasional posture shift ---
    if (now >= this.nextPostureAt) {
      const waist = this.bones.get(this.config.bones.waist);
      if (waist) {
        const base = this.baseRotations.get(waist);
        waist.rotation.z = (base?.z ?? 0) + (Math.random() - 0.5) * 0.05;
      }
      this.nextPostureAt = now + (idle.postureIntervalMin + Math.random() * (idle.postureIntervalMax - idle.postureIntervalMin)) * 1000;
    }

    // --- Keyboard camera controls ---
    const keysActive = this.keys.size > 0 && performance.now() - this.lastKeyTime < 4000;
    if (keysActive && !this.cameraLocked) {
      const orbitSpeed = 1.9;
      const zoomSpeed = 14;
      const step = delta;
      if (this.keys.has("a")) this.orbitYaw -= orbitSpeed * step;
      if (this.keys.has("d")) this.orbitYaw += orbitSpeed * step;
      if (this.keys.has("w")) this.orbitPitch += 0.6 * step;
      if (this.keys.has("s")) this.orbitPitch -= 0.6 * step;
      if (this.keys.has("q")) this.zoomDelta += zoomSpeed * step;
      if (this.keys.has("e")) this.zoomDelta -= zoomSpeed * step;
    }

    // --- Camera ---
    // Refresh world matrices first so the target bone readback is current.
    this.skeleton?.bones.forEach((bone) => bone.updateMatrixWorld(true));
    const camera = this.camera;
    if (camera) {
      const cameraConfig = this.config.camera;
      const distance = THREE.MathUtils.clamp(
        (cameraConfig.distance || 22) + this.zoomDelta,
        cameraConfig.minDistance || 8,
        cameraConfig.maxDistance || 40,
      );
      const yaw = this.orbitYaw + this.pointer.x * (cameraConfig.parallax || 0.055) * 2.2;
      const pitch = THREE.MathUtils.clamp(this.orbitPitch, -0.9, 0.9);
      const targetBone = this.bones.get(cameraConfig.targetBone || "");
      const anchor = new THREE.Vector3(0, cameraConfig.targetOffset || 1.2, 0);
      if (targetBone) anchor.setFromMatrixPosition(targetBone.matrixWorld);
      anchor.y += cameraConfig.targetOffset || 0;
      const height = anchor.y + cameraConfig.heightOffset + pitch * 8;
      camera.position.set(
        anchor.x + Math.sin(yaw) * distance,
        Math.max(2, height),
        anchor.z + Math.cos(yaw) * distance,
      );
      camera.lookAt(anchor);
    }

    this.renderer?.render(this.scene, this.camera!);
  }

  private updateLipSync(delta: number) {
    const lipSync = this.config.lipSync;
    let level = 0;
    if (this.outputAnalyser && this.activity.mode === "talking") {
      const data = new Uint8Array(this.outputAnalyser.frequencyBinCount);
      this.outputAnalyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i += 1) {
        const value = (data[i] - 128) / 128;
        sum += value * value;
      }
      const rms = Math.sqrt(sum / data.length);
      level = Math.max(0, Math.min(1, (rms - lipSync.noiseFloor) * lipSync.gain));
    }
    this.mouthLevel += (level - this.mouthLevel) * (level > this.mouthLevel ? lipSync.attack : lipSync.release);

    // Blend visemes by coarse spectrum shape; the reference blends A/I/U/E/O.
    const visemes = [
      this.config.morphs.visemeA,
      this.config.morphs.visemeI,
      this.config.morphs.visemeU,
      this.config.morphs.visemeE,
      this.config.morphs.visemeO,
    ];
    const bandCount = visemes.length;
    let dominant = 0;
    if (this.outputAnalyser && this.mouthLevel > lipSync.noiseFloor) {
      const bins = new Uint8Array(this.outputAnalyser.frequencyBinCount);
      this.outputAnalyser.getByteFrequencyData(bins);
      const usable = Math.floor(bins.length / 3);
      let bestEnergy = -1;
      for (let band = 0; band < bandCount; band += 1) {
        const start = Math.floor((band / bandCount) * usable);
        const end = Math.floor(((band + 1) / bandCount) * usable);
        let energy = 0;
        for (let i = start; i < end; i += 1) energy += bins[i];
        if (energy > bestEnergy) {
          bestEnergy = energy;
          dominant = band;
        }
      }
    }

    this.visemeWeights.forEach((weight, index) => {
      const target = index === dominant ? this.mouthLevel * lipSync.maxWeight : 0;
      const next = weight + (target - weight) * Math.min(1, delta * 60 * lipSync.visemeBlendRate);
      this.visemeWeights[index] = next;
      this.setMorph(visemes[index], next);
    });
    // General mouth-open morph for natural motion.
    this.setMorph(this.config.morphs.visemeTalk, this.mouthLevel * lipSync.maxWeight * 0.6);
  }

  private setMorph(name: string | undefined, value: number) {
    if (!name || !this.model) return;
    const index = this.morphIndex.get(name);
    if (index === undefined) return;
    this.model.morphTargetInfluences![index] = Math.max(0, Math.min(1, value));
  }
}
