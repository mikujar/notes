#!/usr/bin/env python3
"""兼容旧文件名：请优先使用 yuque-export-notes.py（与本文件等价）。"""

import runpy
import sys
from pathlib import Path

if __name__ == "__main__":
    target = Path(__file__).resolve().with_name("yuque-export-notes.py")
    sys.argv[0] = str(target)
    runpy.run_path(str(target), run_name="__main__")
