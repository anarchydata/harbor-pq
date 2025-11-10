import re
import shutil
import zipfile
from pathlib import Path


def remove_query_table_parts(workbook_path: Path) -> None:
    workbook_path = workbook_path.resolve()
    if not workbook_path.exists():
        raise FileNotFoundError(f"Workbook not found: {workbook_path}")

    backup_path = workbook_path.with_suffix(workbook_path.suffix + ".bak")
    if not backup_path.exists():
        shutil.copy2(workbook_path, backup_path)

    with zipfile.ZipFile(workbook_path, "r") as zin:
        infos = zin.infolist()
        contents = {info.filename: zin.read(info.filename) for info in infos}

    sheet_xml = contents["xl/worksheets/sheet1.xml"].decode("utf-8")
    updated_sheet_xml = re.sub(
        r"<queryTableParts[^>]*>.*?</queryTableParts>", "", sheet_xml, flags=re.DOTALL
    )
    if sheet_xml != updated_sheet_xml:
        contents["xl/worksheets/sheet1.xml"] = updated_sheet_xml.encode("utf-8")

    rels_xml = contents["xl/worksheets/_rels/sheet1.xml.rels"].decode("utf-8")
    updated_rels_xml, removed_count = re.subn(
        r'\s*<Relationship[^>]+Type="http://schemas\.openxmlformats\.org/officeDocument/2006/relationships/queryTable"[^>]*/>',
        "",
        rels_xml,
    )
    if removed_count:
        contents["xl/worksheets/_rels/sheet1.xml.rels"] = updated_rels_xml.encode("utf-8")

    temp_path = workbook_path.with_suffix(".tmp.xlsx")
    with zipfile.ZipFile(temp_path, "w") as zout:
        for info in infos:
            zout.writestr(info, contents[info.filename])

    shutil.move(temp_path, workbook_path)


if __name__ == "__main__":
    target = Path(r"C:\Users\jpo64\Downloads\Query1.xlsx")
    remove_query_table_parts(target)
    print("queryTableParts removed and relationships updated.")

