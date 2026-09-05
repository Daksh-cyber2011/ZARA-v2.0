/**
 * MYRAA character engine — Evelyn model configuration.
 * Extracted verbatim from the reference build (values CONFIRMED):
 * Japanese bone/morph names are standard MMD identifiers; material roles map
 * texture/material names to shading categories; physics groups drive the
 * spring-damper hair/cloth simulation.
 */

export interface CharacterBoneMap {
  root: string;
  center: string;
  groove: string;
  waist: string;
  lowerBody: string;
  upperBody: string;
  upperBody2: string;
  neck: string;
  head: string;
  eyes: string;
  eyeL: string;
  eyeR: string;
  shoulderL: string;
  shoulderR: string;
  armL: string;
  armR: string;
  elbowL: string;
  elbowR: string;
  wristL: string;
  wristR: string;
  [key: string]: string;
}

export interface EvelynConfig {
  id: string;
  displayName: string;
  modelUrl: string;
  textureMapUrl: string;
  scale: number;
  groundOffset: number;
  bones: CharacterBoneMap;
  basePose: Record<string, { x?: number; y?: number; z?: number }>;
  outline: { enabled: boolean; scale: number };
  morphs: Record<string, string>;
  materialRoles: Record<string, string[]>;
  materialTuning: Record<string, Record<string, number | string>>;
  camera: {
    targetBone: string;
    targetOffset: number;
    distance: number;
    fov: number;
    heightOffset: number;
    parallax: number;
    minDistance: number;
    maxDistance: number;
  };
  lighting: Record<string, unknown>;
  render: Record<string, unknown>;
  physics: Record<string, unknown>;
  idle: {
    breathRate: number;
    breathDepth: number;
    swayRate: number;
    swayAmount: number;
    postureIntervalMin: number;
    postureIntervalMax: number;
    blinkIntervalMin: number;
    blinkIntervalMax: number;
    doubleBlinkChance: number;
    saccadeIntervalMin: number;
    saccadeIntervalMax: number;
  };
  behaviour: { intervalMin: number; intervalMax: number; noRepeatWindow: number; busyIntervalScale: number };
  lipSync: {
    attack: number;
    release: number;
    gain: number;
    noiseFloor: number;
    maxWeight: number;
    visemeBlendRate: number;
  };
}

export const EVELYN: EvelynConfig = {
  id: "evelyn",
  displayName: "Evelyn",
  modelUrl: "/assets/characters/evelyn/model.pmx",
  textureMapUrl: "/assets/characters/evelyn/textures.json",
  scale: 1,
  groundOffset: 0,
  bones: {
    root: "全ての親",
    center: "センター",
    groove: "グルーブ",
    waist: "腰",
    lowerBody: "下半身",
    upperBody: "上半身",
    upperBody2: "上半身2",
    neck: "首",
    head: "頭",
    eyes: "両目",
    eyeL: "左目",
    eyeR: "右目",
    shoulderL: "左肩",
    shoulderR: "右肩",
    armL: "左腕",
    armR: "右腕",
    elbowL: "左ひじ",
    elbowR: "右ひじ",
    wristL: "左手首",
    wristR: "右手首",
    thumb0L: "左親指０",
    thumb1L: "左親指１",
    thumb2L: "左親指２",
    index1L: "左人指１",
    index2L: "左人指２",
    index3L: "左人指３",
    middle1L: "左中指１",
    middle2L: "左中指２",
    middle3L: "左中指３",
    ring1L: "左薬指１",
    ring2L: "左薬指２",
    ring3L: "左薬指３",
    little1L: "左小指１",
    little2L: "左小指２",
    little3L: "左小指３",
    thumb0R: "右親指０",
    thumb1R: "右親指１",
    thumb2R: "右親指２",
    index1R: "右人指１",
    index2R: "右人指２",
    index3R: "右人指３",
    middle1R: "右中指１",
    middle2R: "右中指２",
    middle3R: "右中指３",
    ring1R: "右薬指１",
    ring2R: "右薬指２",
    ring3R: "右薬指３",
    little1R: "右小指１",
    little2R: "右小指２",
    little3R: "右小指３",
    legL: "左足",
    legR: "右足",
    kneeL: "左ひざ",
    kneeR: "右ひざ",
    ankleL: "左足首",
    ankleR: "右足首",
  },
  basePose: {
    armL: { z: -0.58, y: 0.1 },
    armR: { z: 0.58, y: -0.1 },
    elbowL: { z: -0.14, y: 0.22 },
    elbowR: { z: 0.14, y: -0.22 },
    wristL: { z: -0.05, y: 0.1 },
    wristR: { z: 0.05, y: -0.1 },
    shoulderL: { z: -0.04 },
    shoulderR: { z: 0.04 },
  },
  outline: { enabled: false, scale: 1 },
  morphs: {
    blink: "まばたき",
    blinkL: "ウィンク",
    blinkR: "ウィンク右",
    smileEyes: "笑い",
    eyesWideL: "びっくり左",
    eyesWideR: "びっくり右",
    eyesHalf: "じと目",
    eyesAngry: "怒り目",
    eyesAngry2: "怒り目２",
    eyesSad: "悲しむ",
    eyeOuterDown: "眼角下",
    lowerLidUp: "下眼上",
    visemeA: "あ",
    visemeI: "い",
    visemeU: "う",
    visemeE: "え",
    visemeO: "お",
    visemeTalk: "ワ",
    mouthSmile: "にやり",
    mouthCornerUpL: "口角上げ左",
    mouthCornerUpR: "口角上げ右",
    mouthCornerDownL: "口角下げ左",
    mouthCornerDownR: "口角下げ右",
    mouthWiden: "口横広げ",
    mouthNarrow: "口横狭め",
    mouthShiftRight: "口右",
    mouthShiftLeft: "口左",
    mouthUp: "口上",
    mouthDown: "口下",
    mouthWidenL: "口横広げ左",
    mouthWidenR: "口横広げ右",
    mouthNarrowL: "口横狭め左",
    mouthNarrowR: "口横狭め右",
    teethUp: "齒上",
    teethDown: "齒下",
    browAngry: "怒り",
    browSerious: "真面目",
    browSad: "悲しい",
    browTroubled: "困る",
    browUp: "上",
    browDown: "下",
    browAngryR: "怒り右",
  },
  materialRoles: {
    skin: ["肌"],
    face: ["颜", "痣"],
    eyeWhite: ["白目"],
    iris: ["目"],
    catchlight: ["目光", "目光2"],
    eyeShadow: ["目影"],
    lash: ["睫", "眉睫影"],
    brow: ["眉"],
    mouth: ["口"],
    teeth: ["齿"],
    tongue: ["舌"],
    hair: ["发", "侧发"],
    frontHair: ["前发"],
    metal: ["金属"],
    jewelry: ["珠宝"],
    leather: ["皮裤", "黑丝衣", "胸衣"],
    lightCloth: ["衬衣"],
    cloth: ["衣", "外套", "外套+", "领带", "领带+", "发带", "穗", "武器"],
  },
  materialTuning: {
    skin: { shadowTint: 14129811, lightTint: 16773609, shadowMid: 0.56, secondShadow: 0.18, shadingSoftness: 0.4, shadowStrength: 0.72, shadowReceive: 0.55, minLight: 0.3, viewKeyStrength: 0.84, brightness: 0.97, localContrast: 0.12, bounceStrength: 0.24, bounceTint: 0.5, warmth: 0.26, aoStrength: 0.68, rimStrength: 0.14, rimPower: 3.2, rimColor: 16767428, specularStrength: 0.06, specularPower: 24, subsurfaceStrength: 0.3, subsurfaceColor: 16748395, outlineWidth: 0.4, outlineColor: 7162440 },
    face: { lightingRig: "face", shadowReceive: 0.38, minLight: 0.7, bounceStrength: 0.28, bounceTint: 0.55, warmth: 0.28, brightness: 0.99, localContrast: 0.12, shadowTint: 14854816, lightTint: 16774638, shadowMid: 0.63, secondShadow: 0.14, shadingSoftness: 0.5, shadowStrength: 0.7, aoStrength: 0.6, rimStrength: 0.14, rimPower: 3.6, rimColor: 16767428, specularStrength: 0.06, specularPower: 28, subsurfaceStrength: 0.34, subsurfaceColor: 16748395, outlineWidth: 0.22, outlineColor: 8016464 },
    eyeWhite: { lightingRig: "face", shadowReceive: 0, minLight: 0.84, shadowTint: 11844308, lightTint: 16777215, shadowMid: 0.55, secondShadow: 0.14, shadingSoftness: 0.45, shadowStrength: 0.6, aoStrength: 0.5, specularStrength: 0.05, saturation: 1, brightness: 0.72, outlineWidth: 0 },
    iris: { lightingRig: "face", shadowReceive: 0, minLight: 0.92, bounceStrength: 0, shadowTint: 6970016, lightTint: 16777215, shadowMid: 0.44, secondShadow: 0.28, shadingSoftness: 0.4, shadowStrength: 0.6, brightness: 0.98, specularStrength: 0.62, specularPower: 140, specularWhiteness: 1, eyeReflectionStrength: 0.42, rimStrength: 0.3, rimPower: 2.4, rimWhiteness: 0.9, rimColor: 14673151, emissiveStrength: 0.1, aoStrength: 0.25, localContrast: 0.4, outlineWidth: 0 },
    catchlight: { unlit: 1, blend: "blend", emissiveStrength: 1, aoStrength: 0, outlineWidth: 0 },
    eyeShadow: { lightingRig: "face", shadowReceive: 0, minLight: 0.55, bounceStrength: 0, shadingSoftness: 0.2, shadowStrength: 0.15, outlineWidth: 0 },
    lash: { lightingRig: "face", shadowReceive: 0, minLight: 0.5, bounceStrength: 0, specularStrength: 0, shadingSoftness: 0.25, shadowStrength: 0.2, outlineWidth: 0 },
    brow: { lightingRig: "face", shadowReceive: 0, minLight: 0.5, bounceStrength: 0, specularStrength: 0, shadingSoftness: 0.2, shadowStrength: 0.16, outlineWidth: 0 },
    mouth: { shadingSoftness: 0.4, shadowStrength: 0.25, specularStrength: 0.12, outlineWidth: 0 },
    teeth: { shadingSoftness: 0.25, shadowStrength: 0.18, specularStrength: 0.08, outlineWidth: 0 },
    tongue: { shadingSoftness: 0.4, shadowStrength: 0.28, specularStrength: 0.18, outlineWidth: 0 },
    hair: { shadowTint: 11442808, lightTint: 16244668, shadowMid: 0.54, secondShadow: 0.28, shadingSoftness: 0.24, shadowStrength: 0.68, shadowReceive: 0.62, minLight: 0.48, brightness: 0.97, localContrast: 0.12, viewFillStrength: 0.68, viewTopStrength: 0.16, viewKeyStrength: 0.9, frontFillTint: 0.08, aoStrength: 0.76, specularWhiteness: 0.18, rimWhiteness: 0.14, rimStrength: 0.14, rimPower: 3.2, rimColor: 16773346, specularStrength: 0.045, specularPower: 38, anisotropicStrength: 0.14, anisotropicShift: 0.18, outlineWidth: 0.5, outlineColor: 2892595 },
    frontHair: { shadowTint: 12165241, lightTint: 16113081, shadowMid: 0.44, secondShadow: 0.14, shadingSoftness: 0.34, shadowStrength: 0.52, shadowReceive: 0.36, minLight: 0.62, brightness: 0.98, localContrast: 0.1, viewKeyStrength: 0.92, viewFillStrength: 0.72, viewTopStrength: 0.16, frontFillTint: 0.08, aoStrength: 0.64, specularWhiteness: 0.18, rimWhiteness: 0.14, rimStrength: 0.12, rimPower: 3.2, rimColor: 16773336, specularStrength: 0.045, specularPower: 40, anisotropicStrength: 0.16, anisotropicShift: 0.16, outlineWidth: 0.45, outlineColor: 3812656 },
    lightCloth: { shadowTint: 10265784, lightTint: 16773864, shadowMid: 0.5, secondShadow: 0.16, shadingSoftness: 0.36, shadowStrength: 0.68, shadowReceive: 0.68, minLight: 0.28, viewKeyStrength: 0.82, viewFillStrength: 0.72, brightness: 0.96, localContrast: 0.1, aoStrength: 0.62, specularWhiteness: 0.08, rimWhiteness: 0.08, rimStrength: 0.14, rimPower: 3.6, rimColor: 15134203, specularStrength: 0.055, specularPower: 24, outlineWidth: 0.48, outlineColor: 3420475 },
    cloth: { shadowTint: 8884912, lightTint: 16775408, shadowMid: 0.52, secondShadow: 0.28, shadingSoftness: 0.3, shadowStrength: 0.84, brightness: 0.99, localContrast: 0.14, aoStrength: 0.72, specularWhiteness: 0.15, rimWhiteness: 0.12, rimStrength: 0.26, rimPower: 3.4, rimColor: 15134203, specularStrength: 0.1, specularPower: 20, outlineWidth: 0.6, outlineColor: 2367278 },
    leather: { shadowTint: 9015466, lightTint: 16774895, shadowMid: 0.48, secondShadow: 0.24, shadingSoftness: 0.28, shadowStrength: 0.82, shadowReceive: 0.7, minLight: 0.34, viewKeyStrength: 0.86, viewFillStrength: 1.15, brightness: 1.03, localContrast: 0.1, aoStrength: 0.68, specularStrength: 0.22, specularPower: 14, specularWhiteness: 0.34, rimStrength: 0.2, rimPower: 3.2, rimWhiteness: 0.24, rimColor: 15134203, sphereStrength: 0.3, outlineWidth: 0.6, outlineColor: 1841190 },
    metal: { specularWhiteness: 0.9, rimWhiteness: 0.8, shadingSoftness: 0.18, shadowStrength: 0.55, rimStrength: 0.3, rimPower: 2.2, specularStrength: 0.4, specularPower: 48, outlineWidth: 0.45, outlineColor: 1972774 },
    jewelry: { specularWhiteness: 1, rimWhiteness: 0.85, shadingSoftness: 0.14, shadowStrength: 0.5, rimStrength: 0.34, rimPower: 2, specularStrength: 0.5, specularPower: 64, emissiveStrength: 0.06, outlineWidth: 0.3, outlineColor: 1972774 },
  },
  camera: {
    targetBone: "上半身2",
    targetOffset: 1.2,
    distance: 22,
    fov: 30,
    heightOffset: 0.4,
    parallax: 0.055,
    minDistance: 8,
    maxDistance: 40,
  },
  lighting: {
    keyIntensity: 0.74,
    keyColor: 16773340,
    keyAzimuth: 22,
    keyElevation: 18,
    fillIntensity: 0.2,
    fillColor: 13491455,
    fillAzimuth: -62,
    fillElevation: 4,
    rimIntensity: 0.12,
    rimColor: 15922943,
    rimAzimuth: 156,
    rimElevation: 34,
    hairLightIntensity: 0.07,
    hairLightColor: 15660287,
    frontFillIntensity: 0.24,
    frontFillColor: 16773862,
    face: {
      keyAzimuth: 18,
      keyElevation: 11,
      keyIntensity: 0.64,
      keyColor: 16773340,
      fillIntensity: 0.33,
      fillColor: 16774378,
      topIntensity: 0.08,
      topColor: 15922943,
      rimIntensity: 0.06,
      rimColor: 15265535,
      bounceIntensity: 0.11,
      bounceColor: 16767419,
    },
    ambientIntensity: 0.15,
    ambientSkyColor: 11451350,
    ambientGroundColor: 7035474,
    environmentIntensity: 0.14,
    shadow: { enabled: true, mapSize: 4096, radius: 8, bias: -0.0006, normalBias: 0.05, opacity: 0.28 },
  },
  render: {
    exposure: 1,
    toneMapping: "neutral",
    bloom: { enabled: false, strength: 0.34, radius: 0.65, threshold: 0.82 },
    antialias: true,
    maxPixelRatio: 2,
    targetFps: 60,
  },
  physics: {
    frequency: 60,
    maxSubSteps: 3,
    gravity: 9.8,
    globalAmplitude: 1,
    groups: {
      ribbon: { match: ["发带"], amplitude: 0.95, stiffness: 0.09, damping: 0.16, restPull: 0.12, maxAngleDeg: 26, gravityScale: 1, inertiaScale: 1.05 },
      hair: { match: ["侧发", "刘海", "碎发", "发穗", "后发髻", "发结"], amplitude: 0.8, stiffness: 0.16, damping: 0.2, restPull: 0.26, maxAngleDeg: 17, gravityScale: 0.85, inertiaScale: 0.95 },
      coat: { match: ["外套", "中外套"], amplitude: 0.85, stiffness: 0.11, damping: 0.22, restPull: 0.2, maxAngleDeg: 21, gravityScale: 1.05, inertiaScale: 1 },
      sleeve: { match: ["外套袖"], amplitude: 0.7, stiffness: 0.15, damping: 0.24, restPull: 0.28, maxAngleDeg: 15, gravityScale: 0.9, inertiaScale: 0.9 },
      tie: { match: ["领带"], amplitude: 0.75, stiffness: 0.14, damping: 0.2, restPull: 0.24, maxAngleDeg: 18, gravityScale: 1, inertiaScale: 0.95 },
      chest: { match: ["胸"], amplitude: 0.3, stiffness: 0.34, damping: 0.42, restPull: 0.62, maxAngleDeg: 5, gravityScale: 0.35, inertiaScale: 0.4 },
      accessory: { match: ["耳坠", "环珠", "背坠", "腰环"], amplitude: 0.8, stiffness: 0.18, damping: 0.18, restPull: 0.22, maxAngleDeg: 20, gravityScale: 1, inertiaScale: 1 },
      lowerBody: { match: ["臀", "足", "ひざ"], amplitude: 0.25, stiffness: 0.4, damping: 0.45, restPull: 0.6, maxAngleDeg: 5, gravityScale: 0.3, inertiaScale: 0.35 },
    },
    fallback: { match: [], amplitude: 0.6, stiffness: 0.18, damping: 0.24, restPull: 0.3, maxAngleDeg: 14, gravityScale: 0.9, inertiaScale: 0.85 },
  },
  idle: {
    breathRate: 0.23,
    breathDepth: 1,
    swayRate: 0.11,
    swayAmount: 1,
    postureIntervalMin: 7,
    postureIntervalMax: 17,
    blinkIntervalMin: 2.4,
    blinkIntervalMax: 7.5,
    doubleBlinkChance: 0.22,
    saccadeIntervalMin: 1.1,
    saccadeIntervalMax: 4.2,
  },
  behaviour: { intervalMin: 6, intervalMax: 15, noRepeatWindow: 4, busyIntervalScale: 2.2 },
  lipSync: {
    attack: 0.42,
    release: 0.2,
    gain: 1.5,
    noiseFloor: 0.035,
    maxWeight: 0.92,
    visemeBlendRate: 0.3,
  },
};

export const CHARACTERS: Record<string, EvelynConfig> = { [EVELYN.id]: EVELYN };
export const DEFAULT_CHARACTER_ID = EVELYN.id;

export function getCharacter(characterId: string = DEFAULT_CHARACTER_ID): EvelynConfig {
  return CHARACTERS[characterId] ?? CHARACTERS[DEFAULT_CHARACTER_ID];
}
