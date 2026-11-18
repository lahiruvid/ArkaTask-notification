"""Generate ICBT Visiting Lecturer micro-lecture PowerPoint."""

from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Inches, Pt

# ICBT-aligned palette: light background, dark navy hierarchy
NAVY = RGBColor(0x0B, 0x1F, 0x3A)
STEEL = RGBColor(0x1E, 0x3A, 0x5F)
ACCENT = RGBColor(0x1A, 0x56, 0x9B)
TEXT = RGBColor(0x1F, 0x29, 0x37)
MUTED = RGBColor(0x4B, 0x55, 0x63)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
SOFT_BG = RGBColor(0xF5, 0xF7, 0xFA)
BAR = RGBColor(0x0B, 0x1F, 0x3A)
LINE = RGBColor(0xD0, 0xD7, 0xE2)

OUTPUT = Path(__file__).resolve().parents[1] / "Lahiru_Abeykoon_JVM_Heap_vs_Stack.pptx"


def set_run_font(run, size_pt, bold=False, color=TEXT, name="Arial"):
    run.font.name = name
    run.font.size = Pt(size_pt)
    run.font.bold = bold
    run.font.color.rgb = color
    rPr = run._r.get_or_add_rPr()
    latin = rPr.find(qn("a:latin"))
    if latin is None:
        latin = rPr.makeelement(qn("a:latin"), {})
        rPr.insert(0, latin)
    latin.set("typeface", name)
    ea = rPr.find(qn("a:ea"))
    if ea is None:
        ea = rPr.makeelement(qn("a:ea"), {})
        rPr.append(ea)
    ea.set("typeface", name)


def add_rect(slide, left, top, width, height, fill):
    shape = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, left, top, width, height)
    shape.fill.solid()
    shape.fill.fore_color.rgb = fill
    shape.line.fill.background()
    return shape


def apply_slide_chrome(slide, prs):
    # Soft page background via full-bleed rectangle
    add_rect(slide, 0, 0, prs.slide_width, prs.slide_height, SOFT_BG)
    # Top navy accent bar
    add_rect(slide, 0, 0, prs.slide_width, Inches(0.12), BAR)
    # Bottom accent line (no footer text)
    add_rect(
        slide,
        0,
        prs.slide_height - Inches(0.45),
        prs.slide_width,
        Inches(0.03),
        LINE,
    )


def add_title(slide, text, top=Inches(0.35), left=Inches(0.55), width=Inches(9.0)):
    box = slide.shapes.add_textbox(left, top, width, Inches(0.85))
    tf = box.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.LEFT
    run = p.add_run()
    run.text = text
    set_run_font(run, 32, bold=True, color=NAVY)
    # Underline accent under title area
    add_rect(slide, left, top + Inches(0.78), Inches(1.4), Inches(0.06), ACCENT)
    return box


def add_bullets(slide, items, top=Inches(1.35), left=Inches(0.7), width=Inches(8.8), height=Inches(5.0)):
    """
    items: list of (bold_label, rest) or plain strings.
    bold_label can be None for plain bullets.
    """
    box = slide.shapes.add_textbox(left, top, width, height)
    tf = box.text_frame
    tf.word_wrap = True

    for i, item in enumerate(items):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.level = 0
        p.space_before = Pt(10)
        p.space_after = Pt(8)
        p.alignment = PP_ALIGN.LEFT

        bullet = "•  "
        if isinstance(item, tuple):
            label, rest = item
            r0 = p.add_run()
            r0.text = bullet
            set_run_font(r0, 20, bold=False, color=TEXT)
            r1 = p.add_run()
            r1.text = label
            set_run_font(r1, 20, bold=True, color=STEEL)
            if rest:
                r2 = p.add_run()
                r2.text = rest
                set_run_font(r2, 20, bold=False, color=TEXT)
        else:
            r0 = p.add_run()
            r0.text = bullet + item
            set_run_font(r0, 20, bold=False, color=TEXT)
    return box


def add_code_chip(slide, text, left, top, width, height, fill=NAVY):
    shape = add_rect(slide, left, top, width, height, fill)
    tf = shape.text_frame
    tf.word_wrap = True
    tf.auto_size = None
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    run = p.add_run()
    run.text = text
    set_run_font(run, 14, bold=True, color=WHITE, name="Consolas")
    shape.text_frame.paragraphs[0].space_before = Pt(6)
    return shape


def build():
    prs = Presentation()
    prs.slide_width = Inches(10)
    prs.slide_height = Inches(7.5)
    blank = prs.slide_layouts[6]

    # --- Slide 1: Title ---
    s = prs.slides.add_slide(blank)
    apply_slide_chrome(s, prs)
    # Left navy panel for academic presence
    add_rect(s, 0, Inches(0.12), Inches(0.28), prs.slide_height - Inches(0.57), NAVY)

    title_box = s.shapes.add_textbox(Inches(0.75), Inches(2.0), Inches(8.6), Inches(1.6))
    tf = title_box.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    run = p.add_run()
    run.text = "Demystifying JVM Architecture:"
    set_run_font(run, 34, bold=True, color=NAVY)
    p2 = tf.add_paragraph()
    p2.space_before = Pt(8)
    run2 = p2.add_run()
    run2.text = "Heap vs. Stack Memory Management"
    set_run_font(run2, 28, bold=True, color=ACCENT)

    add_rect(s, Inches(0.75), Inches(3.85), Inches(1.6), Inches(0.07), ACCENT)

    meta = s.shapes.add_textbox(Inches(0.75), Inches(4.15), Inches(8.5), Inches(1.8))
    mtf = meta.text_frame
    mtf.word_wrap = True
    lines = [
        ("Lahiru Abeykoon", True, NAVY, 22),
        ("Visiting Lecturer Applicant", False, TEXT, 16),
        ("ICBT Kandy Campus", False, MUTED, 16),
    ]
    for i, (text, bold, color, size) in enumerate(lines):
        p = mtf.paragraphs[0] if i == 0 else mtf.add_paragraph()
        p.space_before = Pt(4 if i else 0)
        run = p.add_run()
        run.text = text
        set_run_font(run, size, bold=bold, color=color)

    # --- Slide 2: Learning Outcomes ---
    s = prs.slides.add_slide(blank)
    apply_slide_chrome(s, prs)
    add_title(s, "Learning Outcomes")
    add_bullets(
        s,
        [
            "Differentiate between the structural roles of Stack and Heap memory.",
            "Trace runtime object allocation and reference assignment.",
            "Identify common memory faults: StackOverflowError vs. OutOfMemoryError.",
        ],
        top=Inches(1.55),
    )
    note = s.shapes.add_textbox(Inches(0.7), Inches(5.5), Inches(8.6), Inches(0.7))
    np = note.text_frame.paragraphs[0]
    nr = np.add_run()
    nr.text = "By the end of this micro-lecture, learners can explain JVM memory behaviour with precise CS terminology."
    set_run_font(nr, 13, bold=False, color=MUTED)

    # --- Slide 3: Content (ICBT tips template title) ---
    s = prs.slides.add_slide(blank)
    apply_slide_chrome(s, prs)
    add_title(s, "Content")
    add_bullets(
        s,
        [
            "Overview of Java Virtual Machine (JVM) Memory.",
            "Deconstructing Stack Memory Architecture.",
            "Deconstructing Heap Memory Architecture.",
            "Runtime Mechanics & Memory Allocation Failures.",
        ],
        top=Inches(1.55),
    )

    # --- Slide 4: Stack ---
    s = prs.slides.add_slide(blank)
    apply_slide_chrome(s, prs)
    add_title(s, "Stack Memory Architecture")
    add_bullets(
        s,
        [
            ("LIFO Structures: ", "Operates strictly on a Last-In-First-Out mechanism per thread."),
            ("Scope Isolation: ", "Automatically allocates memory upon method invocation via Stack Frames."),
            ("Data Types: ", "Stores local primitive variables and memory addresses (pointers) of objects."),
            ("Automatic Lifecycle: ", "Instantly deallocates memory the moment a method exits execution."),
        ],
        top=Inches(1.45),
    )
    # Visual cue chips
    add_code_chip(s, "per-thread", Inches(0.7), Inches(5.85), Inches(1.7), Inches(0.38))
    add_code_chip(s, "fast / LIFO", Inches(2.55), Inches(5.85), Inches(1.7), Inches(0.38), STEEL)
    add_code_chip(s, "auto-clean", Inches(4.4), Inches(5.85), Inches(1.7), Inches(0.38), ACCENT)

    # --- Slide 5: Heap ---
    s = prs.slides.add_slide(blank)
    apply_slide_chrome(s, prs)
    add_title(s, "Heap Memory Architecture")
    add_bullets(
        s,
        [
            ("Global Access: ", "A shared, centralized memory pool utilized by all application threads."),
            ("Dynamic Allocation: ", "Houses all newly instantiated Java objects and instance variables."),
            ("Managed Lifecycle: ", "Memory retention is decoupled from method scopes."),
            ("Garbage Collected: ", "Relies on the JVM Garbage Collector (GC) to reclaim unreachable memory."),
        ],
        top=Inches(1.45),
    )
    add_code_chip(s, "shared", Inches(0.7), Inches(5.85), Inches(1.7), Inches(0.38))
    add_code_chip(s, "objects live here", Inches(2.55), Inches(5.85), Inches(2.3), Inches(0.38), STEEL)
    add_code_chip(s, "GC managed", Inches(5.0), Inches(5.85), Inches(1.9), Inches(0.38), ACCENT)

    # --- Slide 6: Runtime & Failures ---
    s = prs.slides.add_slide(blank)
    apply_slide_chrome(s, prs)
    add_title(s, "Runtime Mechanics & Failures")
    add_bullets(
        s,
        [
            ("The Blueprint: ", "Stack holds local references; those references point to objects in the Heap."),
            ("StackOverflowError: ", "Triggered by unbounded recursion or deeply nested method calls."),
            ("OutOfMemoryError: ", "Triggered when the Heap exhausts space due to leaks or uncollected objects."),
        ],
        top=Inches(1.45),
        height=Inches(3.2),
    )

    # Comparison cards
    left_card = add_rect(s, Inches(0.7), Inches(4.55), Inches(4.2), Inches(1.55), WHITE)
    left_card.line.color.rgb = LINE
    tf = left_card.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    r = p.add_run()
    r.text = "StackOverflowError"
    set_run_font(r, 16, bold=True, color=NAVY)
    p2 = tf.add_paragraph()
    p2.space_before = Pt(6)
    r2 = p2.add_run()
    r2.text = "Stack runs out of frames\n(too many nested calls)"
    set_run_font(r2, 14, bold=False, color=TEXT)

    right_card = add_rect(s, Inches(5.15), Inches(4.55), Inches(4.2), Inches(1.55), WHITE)
    right_card.line.color.rgb = LINE
    tf = right_card.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    r = p.add_run()
    r.text = "OutOfMemoryError"
    set_run_font(r, 16, bold=True, color=NAVY)
    p2 = tf.add_paragraph()
    p2.space_before = Pt(6)
    r2 = p2.add_run()
    r2.text = "Heap cannot store more objects\n(leak / GC cannot free enough)"
    set_run_font(r2, 14, bold=False, color=TEXT)

    # --- Slide 7: Summary ---
    s = prs.slides.add_slide(blank)
    apply_slide_chrome(s, prs)
    add_title(s, "Summary & Key Takeaways")
    add_bullets(
        s,
        [
            ("Efficiency Balance: ", "Stack is ultra-fast and self-cleaning; Heap is flexible but carries GC overhead."),
            ("Production Awareness: ", "Understanding this boundary prevents catastrophic enterprise runtime crashes."),
            ("Industry Ready: ", "Mastering memory management is a defining milestone for enterprise Java developers."),
        ],
        top=Inches(1.55),
    )

    # --- Slide 8: References (Harvard) ---
    s = prs.slides.add_slide(blank)
    apply_slide_chrome(s, prs)
    add_title(s, "Academic References")
    refs = [
        "Bloch, J., 2018. Effective Java. 3rd ed. Boston: Addison-Wesley.",
        "Schildt, H., 2022. Java: The Complete Reference. 12th ed. New York: McGraw Hill.",
        "Oracle Corporation, 2026. The Java Virtual Machine Specification: Run-Time Data Areas. [online] Available at: <https://docs.oracle.com/javase/specs/jvms/se21/html/jvms-2.html#jvms-2.5> [Accessed 18 July 2026].",
    ]
    box = s.shapes.add_textbox(Inches(0.7), Inches(1.5), Inches(8.7), Inches(4.8))
    tf = box.text_frame
    tf.word_wrap = True
    for i, ref in enumerate(refs):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.space_before = Pt(12)
        p.space_after = Pt(6)
        r = p.add_run()
        r.text = f"•  {ref}"
        set_run_font(r, 15, bold=False, color=TEXT)

    # --- Slide 9: Thank You ---
    s = prs.slides.add_slide(blank)
    apply_slide_chrome(s, prs)
    add_rect(s, 0, Inches(0.12), Inches(0.28), prs.slide_height - Inches(0.57), NAVY)

    box = s.shapes.add_textbox(Inches(0.75), Inches(2.2), Inches(8.5), Inches(1.2))
    tf = box.text_frame
    p = tf.paragraphs[0]
    r = p.add_run()
    r.text = "Thank You! Any Questions?"
    set_run_font(r, 36, bold=True, color=NAVY)

    add_rect(s, Inches(0.75), Inches(3.45), Inches(1.6), Inches(0.07), ACCENT)

    add_bullets(
        s,
        [
            "Thank you for your time and consideration.",
            "I welcome questions on JVM performance tuning, garbage collection strategies, or memory diagnostics.",
        ],
        top=Inches(3.8),
        height=Inches(2.0),
    )

    prs.save(OUTPUT)
    print(f"Saved: {OUTPUT}")


if __name__ == "__main__":
    build()
