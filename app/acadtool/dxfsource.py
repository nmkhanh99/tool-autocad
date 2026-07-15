"""DWG -> DXF qua ODA File Converter, có cache.

Backend đọc/ghi tin cậy thay cho LibreDWG: ODA File Converter (miễn phí) chuyển
DWG <-> DXF chuẩn, ezdxf đọc/ghi DXF sạch (không mojibake, đọc được cả file mà
LibreDWG parse hỏng). Module này chỉ lo phần DWG->DXF; ezdxf đọc DXF ở model.py.

Cài ODA: https://www.opendesign.com/guestfiles/oda_file_converter (bản macOS).
Sau khi cài, app tự dò binary trong /Applications; hoặc đặt biến môi trường
ODA_FILE_CONVERTER trỏ tới binary.
"""
from __future__ import annotations

import hashlib
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

CACHE_DIR = Path.home() / ".cache" / "acadtool"

# DXF xuất ra: bản ACAD2018 ASCII cho ezdxf đọc ổn định nhất.
_OUT_VERSION = "ACAD2018"
_OUT_TYPE = "DXF"

# Các vị trí binary ODA File Converter hay gặp trên macOS.
_CANDIDATES = [
    "/Applications/ODAFileConverter.app/Contents/MacOS/ODAFileConverter",
    "/Applications/ODAFileConverter_QT6.app/Contents/MacOS/ODAFileConverter",
]


class OdaError(RuntimeError):
    pass


def oda_binary() -> str | None:
    """Trả path binary ODA File Converter, hoặc None nếu chưa cài."""
    env = os.environ.get("ODA_FILE_CONVERTER")
    if env and Path(env).is_file():
        return env
    which = shutil.which("ODAFileConverter")
    if which:
        return which
    for c in _CANDIDATES:
        if Path(c).is_file():
            return c
    return None


def oda_available() -> bool:
    return oda_binary() is not None


def _cache_path(dwg: Path) -> Path:
    st = dwg.stat()
    key = f"{dwg.resolve()}|{st.st_mtime_ns}|{st.st_size}|{_OUT_VERSION}"
    digest = hashlib.sha1(key.encode("utf-8")).hexdigest()[:16]
    return CACHE_DIR / f"{dwg.stem}.{digest}.dxf"


def dwg_to_dxf(dwg_path: str | Path, *, force: bool = False) -> Path:
    """Chuyển 1 file .dwg -> .dxf (cache theo mtime+size), trả path .dxf.

    ODA File Converter làm việc theo THƯ MỤC, nên ta chuyển qua thư mục tạm:
    copy dwg -> in_dir, convert -> out_dir, dời .dxf vào cache.
    """
    dwg = Path(dwg_path)
    if not dwg.is_file():
        raise OdaError(f"Không thấy file: {dwg}")

    cache = _cache_path(dwg)
    if cache.is_file() and not force:
        return cache

    binary = oda_binary()
    if not binary:
        raise OdaError(
            "Chưa cài ODA File Converter. Tải bản macOS ở "
            "opendesign.com rồi cài, hoặc đặt ODA_FILE_CONVERTER trỏ tới binary."
        )

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="acadtool_oda_") as tmp:
        in_dir = Path(tmp) / "in"
        out_dir = Path(tmp) / "out"
        in_dir.mkdir()
        out_dir.mkdir()
        shutil.copy2(dwg, in_dir / dwg.name)

        # ODAFileConverter <in> <out> <version> <type> <recurse> <audit> [filter]
        proc = subprocess.run(
            [binary, str(in_dir), str(out_dir), _OUT_VERSION, _OUT_TYPE,
             "0", "1", dwg.name],
            capture_output=True,
            text=True,
            env={**os.environ, "QT_QPA_PLATFORM": "offscreen"},
        )
        produced = out_dir / f"{dwg.stem}.dxf"
        if not produced.is_file():
            msg = (proc.stderr or proc.stdout or "").strip()[:300]
            raise OdaError(
                f"ODA không tạo được DXF cho {dwg.name}. "
                f"rc={proc.returncode} {msg}"
            )
        tmp_cache = cache.with_suffix(".tmp.dxf")
        shutil.move(str(produced), tmp_cache)
        tmp_cache.replace(cache)
    return cache
