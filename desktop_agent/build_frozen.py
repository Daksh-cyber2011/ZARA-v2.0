"""PyInstaller build script for the MYRAA desktop agent (Windows)."""
import PyInstaller.__main__

PyInstaller.__main__.run([
    "run_agent.py",
    "--name", "myraa-agent",
    "--onefile",
    "--noconsole",
    "--clean",
])
