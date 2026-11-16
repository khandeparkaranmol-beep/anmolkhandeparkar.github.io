"""Inline the shared style so downloaded project previews stay self-contained."""
from pathlib import Path
import re
root=Path(__file__).resolve().parents[1]
css=(root/'styles/presentation.css').read_text()
for p in root.glob('*.html'):
 s=p.read_text()
 s=re.sub(r'<style id="shared-presentation">[\s\S]*?</style>\s*','',s)
 s=s.replace('</head>','<style id="shared-presentation">\n'+css+'</style>\n</head>',1)
 s=s.replace('<html lang="en">','<html lang="en" data-theme="dark">')
 s=s.replace("localStorage.getItem('theme')", "localStorage.getItem('portfolio-theme')")
 s=s.replace("localStorage.setItem('theme',", "localStorage.setItem('portfolio-theme',")
 s=s.replace("saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme:dark)').matches)","saved !== 'light'")
 s=s.replace("(window.matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light')","'dark'")
 s=s.replace("(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')","'dark'")
 p.write_text(s)
 print(p.name)
