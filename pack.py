from pathlib import Path
import itertools
import shutil
import os

PROJ_PATH = Path(__file__).parent
BUILD_PATH = PROJ_PATH / "build" / "spruton-toys-app"
EXCLUDE = tuple(
    PROJ_PATH / i
    for i in (
        ".local",
        "node_modules",
        ".yarn",
        ".vscode",
    )
)

shutil.rmtree(BUILD_PATH)
BUILD_PATH.mkdir()
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
        if i in path.parents:
            skip = True
            break
    if skip:
        continue

    if not path.is_file():
        continue

    out = BUILD_PATH / path.relative_to(PROJ_PATH)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.touch()
    shutil.copyfile(path, out)
os.system("del build.zip")
os.system(f"zip -r build.zip {BUILD_PATH.absolute()}")
