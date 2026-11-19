from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
W, H = A4
import os
c = canvas.Canvas(os.path.join(os.path.dirname(__file__), "word.pdf"), pagesize=A4)
def page(n, body):
    c.setFont("Helvetica", 8); c.drawString(72, H-40, "SPOJ Regional Contest 2019"); c.drawCentredString(W/2, 30, str(n))
    y = H-90
    for kind, txt in body:
        if kind == 'h':
            c.setFont("Times-Bold", 14); c.drawString(72, y, txt); y -= 22
        elif kind == 'p':
            x = 72
            for seg in txt:
                font, s = seg
                c.setFont(font, 11); c.drawString(x, y, s); x += c.stringWidth(s, font, 11)
            y -= 14
        elif kind == 'gap': y -= 8
        elif kind == 'pre':
            c.setFont("Courier", 10)
            for l in txt: c.drawString(72, y, l); y -= 12
            y -= 6
    c.showPage()
for n in range(1, 4):
    page(n, [('h', f'Problem {n}: Strings'), ('p', [("Times-Roman", "You are given a string "), ("Times-Italic", "S"), ("Times-Roman", " of length "), ("Times-Italic", "n"), ("Times-Roman", ". Find the longest")]),
             ('p', [("Times-Roman", "substring that appears twice. Answer modulo 10"), ("Times-Roman", "9")]), ('gap', ''), ('h', 'Input'), ('p', [("Times-Roman", "Each line has an integer "), ("Times-Italic", "n"), ("Times-Roman", ".")]),
             ('h', 'Example'), ('pre', ['Input:', '3', 'abcabc', '', 'Output:', '3'])])
c.save()
