"""Generate ArkaTasks Client Access Guide as a 2-page Word document."""
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
from docx.shared import Cm, Pt, RGBColor


OUT = Path(__file__).resolve().parents[1] / "ArkaTask-Client-Access-Guide.docx"


def set_cell_shading(cell, hex_color: str) -> None:
    shading = OxmlElement("w:shd")
    shading.set(qn("w:fill"), hex_color)
    shading.set(qn("w:val"), "clear")
    cell._tc.get_or_add_tcPr().append(shading)


def style_run(run, *, size=10, bold=False, color=None, italic=False):
    run.font.name = "Calibri"
    run._element.rPr.rFonts.set(qn("w:eastAsia"), "Calibri")
    run.font.size = Pt(size)
    run.bold = bold
    run.italic = italic
    if color:
        run.font.color.rgb = RGBColor(*color)


def add_para(doc, text, *, size=10, bold=False, space_after=4, space_before=0, color=None, italic=False, align=None):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(space_after)
    p.paragraph_format.space_before = Pt(space_before)
    p.paragraph_format.line_spacing_rule = WD_LINE_SPACING.SINGLE
    if align:
        p.alignment = align
    run = p.add_run(text)
    style_run(run, size=size, bold=bold, color=color, italic=italic)
    return p


def add_heading_bar(doc, number: str, title: str):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(8)
    p.paragraph_format.space_after = Pt(4)
    r1 = p.add_run(f"{number}  ")
    style_run(r1, size=12, bold=True, color=(15, 76, 92))
    r2 = p.add_run(title)
    style_run(r2, size=12, bold=True, color=(15, 76, 92))
    return p


def add_bullet(doc, text, *, size=10, bold_prefix=None):
    p = doc.add_paragraph(style="List Bullet")
    p.paragraph_format.space_after = Pt(2)
    p.paragraph_format.space_before = Pt(0)
    p.paragraph_format.line_spacing = 1.05
    if bold_prefix:
        r1 = p.add_run(bold_prefix)
        style_run(r1, size=size, bold=True)
        r2 = p.add_run(text)
        style_run(r2, size=size)
    else:
        r = p.add_run(text)
        style_run(r, size=size)
    return p


def add_two_col_table(doc, rows, col_widths=(4.2, 11.5)):
    table = doc.add_table(rows=len(rows), cols=2)
    table.style = "Table Grid"
    for i, (left, right) in enumerate(rows):
        c0, c1 = table.rows[i].cells
        c0.width = Cm(col_widths[0])
        c1.width = Cm(col_widths[1])
        c0.text = ""
        c1.text = ""
        p0 = c0.paragraphs[0]
        p1 = c1.paragraphs[0]
        p0.paragraph_format.space_after = Pt(1)
        p0.paragraph_format.space_before = Pt(1)
        p1.paragraph_format.space_after = Pt(1)
        p1.paragraph_format.space_before = Pt(1)
        r0 = p0.add_run(left)
        style_run(r0, size=9.5, bold=True, color=(30, 30, 30))
        r1 = p1.add_run(right)
        style_run(r1, size=9.5)
        if i == 0:
            set_cell_shading(c0, "E8F1F4")
            set_cell_shading(c1, "E8F1F4")
    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    return table


def add_callout(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(2)
    p.paragraph_format.space_after = Pt(6)
    p.paragraph_format.left_indent = Cm(0.2)
    r = p.add_run(text)
    style_run(r, size=9.5, italic=True, color=(80, 80, 80))
    return p


def main():
    doc = Document()

    # Page setup — A4, tighter margins for 2 pages
    section = doc.sections[0]
    section.page_width = Cm(21.0)
    section.page_height = Cm(29.7)
    section.left_margin = Cm(1.6)
    section.right_margin = Cm(1.6)
    section.top_margin = Cm(1.3)
    section.bottom_margin = Cm(1.3)

    # Header title
    title = doc.add_paragraph()
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    title.paragraph_format.space_after = Pt(2)
    r = title.add_run("ArkaTasks — Client Access Guide")
    style_run(r, size=18, bold=True, color=(15, 76, 92))

    sub = doc.add_paragraph()
    sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
    sub.paragraph_format.space_after = Pt(2)
    r = sub.add_run("DClean  ·  Cleaning schedule app")
    style_run(r, size=11, color=(70, 70, 70))

    priv = doc.add_paragraph()
    priv.alignment = WD_ALIGN_PARAGRAPH.CENTER
    priv.paragraph_format.space_after = Pt(6)
    r = priv.add_run("PRIVATE — Keep this document safe. It contains login details.")
    style_run(r, size=9.5, bold=True, color=(140, 50, 40))

    # 1. Open the app
    add_heading_bar(doc, "1.", "Open the app")
    add_para(
        doc,
        "ArkaTasks is your online cleaning schedule. Use it on a phone or computer — no install needed.",
        size=10,
        space_after=4,
    )
    add_two_col_table(
        doc,
        [
            ("What", "Details"),
            ("Website address", "https://dclean-arkatasks.pages.dev"),
            ("App name", "ArkaTasks"),
            ("Company", "DClean"),
            ("Best browsers", "Chrome, Safari, or Edge"),
        ],
    )
    add_bullet(doc, "Open the website address above on your phone or laptop.")
    add_bullet(
        doc,
        "On a phone: open the browser menu → Add to Home Screen for a quick icon.",
    )

    # 2. Sign in
    add_heading_bar(doc, "2.", "Sign in (once per device)")
    add_two_col_table(
        doc,
        [
            ("Item", "Value"),
            ("Username", "admin"),
            ("Password", "admin"),
        ],
    )
    add_bullet(doc, "You only need to sign in once on each phone or computer. The app remembers you.")
    add_bullet(doc, "On a shared computer, tap Sign out in the menu when you finish.")
    add_bullet(
        doc,
        "When you open Settings, the app asks for the password again every time (same password: admin).",
    )
    add_callout(
        doc,
        "Tip: Ask your developer to change this password later if other people might see this sheet.",
    )

    # 3. First-day checklist
    add_heading_bar(doc, "3.", "First-day checklist (do this once)")
    add_bullet(doc, "Open the website and sign in with admin / admin.", bold_prefix="Step 1 — ")
    add_bullet(
        doc,
        "Go to Settings → Cloud sync and confirm it says connected "
        "(your developer may already have set this up).",
        bold_prefix="Step 2 — ",
    )
    add_bullet(
        doc,
        "Activate email backup once (see section 5 below).",
        bold_prefix="Step 3 — ",
    )
    add_bullet(
        doc,
        "Use Calendar for daily work. Use Apply default only when you want to load your saved default schedule.",
        bold_prefix="Step 4 — ",
    )

    # 4. Cloud sync
    add_heading_bar(doc, "4.", "Keep phone and laptop in sync (Cloud)")
    add_para(
        doc,
        "Cloud sync means your places, employees, and jobs stay the same on every device. "
        "This uses a free online account called Supabase (you do not need to use it every day).",
        size=10,
        space_after=4,
    )
    add_two_col_table(
        doc,
        [
            ("Item", "Write here / notes"),
            ("Website", "https://supabase.com"),
            ("Project name", "________________________________"),
            ("Project URL", "________________________________"),
            ("Public API key", "________________________________"),
            ("Login", "Email & password of the Supabase account owner"),
        ],
    )
    add_para(doc, "If Cloud sync is not connected yet (one-time setup):", size=10, bold=True, space_after=2)
    add_bullet(doc, "Open supabase.com and sign in to your project.")
    add_bullet(doc, "Go to Project Settings → API.")
    add_bullet(doc, "Copy Project URL and the anon public key into the table above.")
    add_bullet(doc, "In ArkaTasks: Settings → Cloud sync → paste both → Save & connect.")
    add_bullet(doc, "Repeat on every phone/laptop that should share the same data.")
    add_callout(
        doc,
        "You can ask your developer to fill this section and connect the first device for you.",
    )

    # 5. Email backup
    add_heading_bar(doc, "5.", "Daily email backup")
    add_para(
        doc,
        "Once a day (when you open the app), a backup copy can be sent to email — free, no extra cost.",
        size=10,
        space_after=4,
    )
    add_two_col_table(
        doc,
        [
            ("Item", "Details"),
            ("Backup email", "dcleanmilanoitalia@gmail.com"),
            ("How often", "About once per day when the app is opened"),
            ("Send now", "Settings → Backup & recover → Send backup email now"),
        ],
    )
    add_para(doc, "First time only — activate the email service:", size=10, bold=True, space_after=2)
    add_bullet(doc, "Open the Gmail inbox above (also check Spam / Junk).")
    add_bullet(doc, "Find the message asking you to Activate / Confirm the form.")
    add_bullet(doc, "Click Activate, then send a backup again from Settings if needed.")
    add_callout(
        doc,
        "Until you activate once, backup emails will not arrive.",
    )

    # 6. Where data is kept
    add_heading_bar(doc, "6.", "Where your data is kept (all free)")
    add_para(
        doc,
        "You do not need to manage these storage places day to day. This is only so you know nothing is “lost” in one place.",
        size=10,
        space_after=4,
    )
    add_two_col_table(
        doc,
        [
            ("Copy", "Where it lives"),
            ("Working copy", "On each phone/computer (in the browser)"),
            ("Device snapshots", "Saved on that same device for quick restore"),
            ("Shared live copy", "Cloud (Supabase) — shared across devices"),
            ("Cloud history", "Older cloud uploads you can restore from"),
            ("Email copy", "In the Gmail inbox above (after activation)"),
        ],
    )
    add_para(
        doc,
        "To restore: Settings → Backup & recover → choose a device snapshot, cloud history, or Import JSON.",
        size=10,
        space_after=4,
    )

    # 7. Website hosting
    add_heading_bar(doc, "7.", "Website hosting (for updates — usually developer)")
    add_para(
        doc,
        "The app website is hosted on Cloudflare Pages (free). You only need this if you publish a new version of the site.",
        size=10,
        space_after=4,
    )
    add_two_col_table(
        doc,
        [
            ("Item", "Details"),
            ("Dashboard", "https://dash.cloudflare.com"),
            ("Where to look", "Workers & Pages → Pages"),
            ("Project name", "dclean-arkatasks (or as named in your account)"),
            ("Login", "Cloudflare account email & password that owns the site"),
        ],
    )
    add_callout(
        doc,
        "Updates are published by uploading the app’s “out” folder to that Pages project. Ask your developer for help with this.",
    )

    # 8. Important reminders
    add_heading_bar(doc, "8.", "Important reminders")
    add_bullet(doc, "This app is for the owner / office. Free plans cover normal daily use.")
    add_bullet(
        doc,
        "If you clear browser data on a phone or PC, that device’s local copy is removed. "
        "You can restore from Cloud, email, or Backup & recover.",
    )
    add_bullet(doc, "Do not post this sheet online or share it widely — it contains access details.")

    # Footer
    foot = doc.add_paragraph()
    foot.alignment = WD_ALIGN_PARAGRAPH.CENTER
    foot.paragraph_format.space_before = Pt(10)
    foot.paragraph_format.space_after = Pt(0)
    r = foot.add_run("Document date: 17 July 2026  ·  Prepared for DClean (client handoff)")
    style_run(r, size=9, color=(100, 100, 100), italic=True)

    doc.save(OUT)
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
