"""acadtool — offline MEP as-built drawing tool (read engine + BOM + title block).

Backend hiện tại: LibreDWG (dwgread -> JSON) cho phần ĐỌC.
Reader tách lớp ở model.read_drawing(); sau này thay bằng ODA File Converter
+ ezdxf để có ghi/PDF tin cậy và đọc được mọi file.
"""

__version__ = "0.1.0"
