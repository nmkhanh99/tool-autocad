"""DWG -> JSON qua LibreDWG (dwgread), có cache.

Đây là lớp BACKEND đọc duy nhất chạm tới file .dwg. Khi chuyển sang ODA
File Converter + ezdxf, chỉ cần thay module này (và model.py đọc nguồn mới).
"""
from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
from pathlib import Path

CACHE_DIR = Path.home() / ".cache" / "acadtool"


class DwgReadError(RuntimeError):
    pass


def _dwgread_bin() -> str:
    exe = shutil.which("dwgread")
    if not exe:
        raise DwgReadError(
            "Không tìm thấy 'dwgread' (LibreDWG). Cài: brew install libredwg"
        )
    return exe


def _cache_path(dwg: Path) -> Path:
    st = dwg.stat()
    key = f"{dwg.resolve()}|{st.st_mtime_ns}|{st.st_size}"
    digest = hashlib.sha1(key.encode("utf-8")).hexdigest()[:16]
    return CACHE_DIR / f"{dwg.stem}.{digest}.json"


def dwg_to_json(dwg_path: str | Path, *, force: bool = False) -> dict:
    """Trả về dict JSON của bản vẽ. Cache theo mtime+size để chạy lại nhanh.

    Raise DwgReadError nếu LibreDWG xuất JSON hỏng (đã gặp với 1 file thật) —
    file đó cần ODA File Converter để đọc.
    """
    dwg = Path(dwg_path)
    if not dwg.is_file():
        raise DwgReadError(f"Không thấy file: {dwg}")

    cache = _cache_path(dwg)
    if cache.is_file() and not force:
        return _load_json(cache)

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    tmp = cache.with_suffix(".tmp.json")
    proc = subprocess.run(
        [_dwgread_bin(), "-O", "JSON", "-o", str(tmp), str(dwg)],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        tmp.unlink(missing_ok=True)
        raise DwgReadError(f"dwgread lỗi ({dwg.name}): {proc.stderr.strip()[:300]}")

    try:
        data = _load_json(tmp)
    except json.JSONDecodeError as e:
        tmp.unlink(missing_ok=True)
        raise DwgReadError(
            f"LibreDWG xuất JSON hỏng cho {dwg.name} (vị trí {e.pos}). "
            f"File này cần ODA File Converter để đọc."
        ) from e
    tmp.replace(cache)
    return data


def _load_json(path: Path) -> dict:
    # LibreDWG ghi tên/chuỗi theo codepage cũ -> không phải UTF-8 hợp lệ.
    with open(path, "r", encoding="latin-1") as f:
        return json.load(f)
