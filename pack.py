from pathlib import Path
import itertools
import shutil
import sys
import os

PROJ_PATH = Path(__file__).parent
BUILD_PATH = PROJ_PATH / "build"
BUILD_OUT_PATH = BUILD_PATH / "spruton-toys-app"
EXCLUDE = tuple(
    PROJ_PATH / i
    for i in (
        ".local",
        "node_modules",
        ".yarn",
        ".vscode",
        "config.yml"
    )
)

if BUILD_PATH.exists():
    shutil.rmtree(BUILD_PATH)
BUILD_OUT_PATH.mkdir(parents=True)
for path in tuple(
    itertools.chain(
        PROJ_PATH.glob("*/dist/*"),
        PROJ_PATH.rglob("*.json"),
        PROJ_PATH.rglob("./*.sh"),
        PROJ_PATH.rglob("*.lock"),
        PROJ_PATH.rglob("*.yml"),
        (PROJ_PATH / "patches").iterdir(),
        (PROJ_PATH / ".nvmrc", ),
    )
):
    skip = False
    for i in EXCLUDE:
        if i in itertools.chain((path, ), path.parents):
            skip = True
            break
    if skip:
        continue

    if not path.is_file():
        continue

    out = BUILD_OUT_PATH / path.relative_to(PROJ_PATH)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.touch()
    shutil.copyfile(path, out)

if sys.argv[-1] == "deps":
    os.chdir(BUILD_OUT_PATH)
    os.system("bash pack_install_deps.sh")

os.chdir(BUILD_PATH)
os.system(f"zip -r build.zip {BUILD_OUT_PATH.relative_to(BUILD_PATH)}")
