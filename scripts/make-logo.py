#!/usr/bin/env python3
"""Generates the Hiraku Judges Translator logo/icons (SVG). Usage: python3 scripts/make-logo.py [outdir]"""
import sys
GRAD = '''<defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" y1="{y1}" x2="0" y2="{y2}"><stop offset="0" stop-color="#ee0f7f"/><stop offset="0.4" stop-color="#ff8db8"/><stop offset="0.68" stop-color="#d4a2c8"/><stop offset="1" stop-color="#3b2477"/></linearGradient></defs>'''

def sparkle(cx, cy, rv, rh):
    k = rv * 0.09
    return (f'<path d="M{cx},{cy-rv}Q{cx+k:.1f},{cy-k:.1f} {cx+rh},{cy}Q{cx+k:.1f},{cy+k:.1f} {cx},{cy+rv}'
            f'Q{cx-k:.1f},{cy+k:.1f} {cx-rh},{cy}Q{cx-k:.1f},{cy-k:.1f} {cx},{cy-rv}Z"/>')

def letter_J():
    # Didone J: flat top serif, thick stem, hook thinning into a ball terminal
    return ('<path d="M-4,40H58V45H40V185C40,230 20,253 -10,253C-34,253 -50,240 -55,221L-49,219'
            'C-44,233 -32,240 -18,238C0,236 12,220 12,185V45H-4Z"/>'
            '<circle cx="-45" cy="213" r="11"/>')

def letter_T():
    return ('<rect x="-62" y="40" width="124" height="6"/>'
            '<rect x="-62" y="40" width="5" height="30"/><rect x="57" y="40" width="5" height="30"/>'
            '<rect x="-14" y="46" width="28" height="209"/>'
            '<rect x="-34" y="255" width="68" height="5"/>')

def J_extras(icon):
    sw = 2.6 if icon else 1.4
    return (f'<ellipse cx="0" cy="150" rx="104" ry="28" transform="rotate(-28 0 150)" fill="none" stroke="url(#g)" stroke-width="{sw}"/>'
            '<g fill="url(#g)">' + sparkle(-42, 92, 30, 19) + sparkle(76, 214, 15, 9.5) + '</g>'
            '<g fill="url(#g)"><circle cx="88" cy="96" r="4"/><circle cx="-92" cy="196" r="3.4"/></g>')

def T_extras(icon):
    sw = 2.6 if icon else 1.4
    return (f'<path d="M-52,92 L52,226" stroke="url(#g)" stroke-width="{sw}" fill="none"/>'
            '<g fill="url(#g)"><circle cx="-52" cy="92" r="5"/><circle cx="52" cy="226" r="5"/>'
            + sparkle(0, 159, 34, 21) + sparkle(62, 112, 14, 9) + '</g>')

def small_icon():
    # 16-32 px: no hairlines, a heavier J and one sparkle
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="-145 5 290 290" width="512" height="512"><title>Hiraku Judges Translator</title>'
            + GRAD.format(y1=30, y2=260) +
            '<rect x="-145" y="5" width="290" height="290" rx="60" fill="#1a1230"/>'
            '<g fill="url(#g)" transform="translate(10,-6) scale(1.05)">'
            '<path d="M-14,40H66V50H46V180C46,232 22,258 -14,258C-42,258 -60,242 -66,220L-52,215'
            'C-46,232 -34,240 -20,238C2,236 14,218 14,180V50H-14Z"/><circle cx="-50" cy="210" r="16"/>'
            + sparkle(-62, 90, 42, 27) + '</g></svg>\n')

def svg(kind, icon, title='Hiraku Judges Translator'):
    letter, extras = (letter_J(), J_extras(icon)) if kind == 'J' else (letter_T(), T_extras(icon))
    if icon:
        head = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-145 5 290 290" width="512" height="512">'
        body = '<rect x="-145" y="5" width="290" height="290" rx="60" fill="#1a1230"/><g transform="translate(0,4) scale(0.98)">' + extras + '<g fill="url(#g)">' + letter + '</g></g>'
    else:
        head = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-115 20 230 260" width="460" height="520">'
        body = extras + '<g fill="url(#g)">' + letter + '</g>'
    return head + f'<title>{title}</title>' + GRAD.format(y1=30, y2=260) + body + '</svg>\n'

out = sys.argv[1] if len(sys.argv) > 1 else 'icons'
import os
os.makedirs(out, exist_ok=True)
open(f'{out}/icon-small.svg', 'w').write(small_icon())
for k in 'J':
    open(f'{out}/' + ('logo.svg' if k == 'J' else 'logo-T.svg'), 'w').write(svg(k, False))
    open(f'{out}/' + ('icon.svg' if k == 'J' else 'icon-T.svg'), 'w').write(svg(k, True))
