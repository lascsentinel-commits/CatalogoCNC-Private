import os
import re
from pathlib import Path

def parse_gcode_dimensions(file_path):
    """
    Lee un archivo G-code (.nc, .gcode, .tap) y calcula:
    - Ancho (W) en mm
    - Alto (H) en mm
    - Profundidad (Z) en mm
    - Coordenadas mínimas y máximas
    """
    min_x, max_x = float('inf'), float('-inf')
    min_y, max_y = float('inf'), float('-inf')
    min_z, max_z = float('inf'), float('-inf')
    
    count = 0
    try:
        with open(file_path, 'r', errors='ignore') as f:
            for line in f:
                line = line.strip().upper()
                if not line or line.startswith(('(', ';', '%')):
                    continue
                
                mx = re.search(r'X([-\d\.]+)', line)
                my = re.search(r'Y([-\d\.]+)', line)
                mz = re.search(r'Z([-\d\.]+)', line)
                
                if mx:
                    x = float(mx.group(1))
                    min_x = min(min_x, x)
                    max_x = max(max_x, x)
                    count += 1
                if my:
                    y = float(my.group(1))
                    min_y = min(min_y, y)
                    max_y = max(max_y, y)
                    count += 1
                if mz:
                    z = float(mz.group(1))
                    min_z = min(min_z, z)
                    max_z = max(max_z, z)
    except Exception as e:
        print(f"Error parsing G-code dimensions for {file_path}: {e}")
        return 0, 0, 0

    w = max(0.0, max_x - min_x) if min_x != float('inf') else 0.0
    h = max(0.0, max_y - min_y) if min_y != float('inf') else 0.0
    d = max(0.0, max_z - min_z) if min_z != float('inf') else 0.0
    return round(w, 1), round(h, 1), round(d, 1)

def generate_toolpath_svg(file_path, size=260):
    """
    Genera un SVG vectorial desde arriba (Top-Down 2D) de los trazos de corte.
    """
    min_x, max_x = float('inf'), float('-inf')
    min_y, max_y = float('inf'), float('-inf')
    
    segments = []
    current_seg = []
    
    try:
        with open(file_path, 'r', errors='ignore') as f:
            for line in f:
                line = line.strip().upper()
                if not line or line.startswith(('(', ';', '%')):
                    continue
                
                is_g0 = 'G0' in line or 'G00' in line
                
                mx = re.search(r'X([-\d\.]+)', line)
                my = re.search(r'Y([-\d\.]+)', line)
                
                if mx or my:
                    x = float(mx.group(1)) if mx else (current_seg[-1][0] if current_seg else 0.0)
                    y = float(my.group(1)) if my else (current_seg[-1][1] if current_seg else 0.0)
                    
                    min_x = min(min_x, x)
                    max_x = max(max_x, x)
                    min_y = min(min_y, y)
                    max_y = max(max_y, y)
                    
                    if is_g0:
                        if current_seg:
                            segments.append(current_seg)
                            current_seg = []
                    else:
                        current_seg.append((x, y))
                        
        if current_seg:
            segments.append(current_seg)
    except Exception as e:
        print(f"Error generating SVG for {file_path}: {e}")
        return None, 0, 0
        
    w = (max_x - min_x) if min_x != float('inf') else 1.0
    h = (max_y - min_y) if min_y != float('inf') else 1.0
    if w <= 0: w = 1.0
    if h <= 0: h = 1.0
    
    pad = 20
    avail_w = size - pad * 2
    avail_h = size - pad * 2
    scale = min(avail_w / w, avail_h / h)
    
    svg_paths = []
    # Sample down points if extremely dense (>5000 pts)
    for seg in segments:
        if len(seg) < 2:
            continue
        step = max(1, len(seg) // 800)
        pts = []
        for i in range(0, len(seg), step):
            sx, sy = seg[i]
            px = pad + (sx - min_x) * scale
            py = size - (pad + (sy - min_y) * scale) # Invertir eje Y CNC
            pts.append(f"{px:.1f},{py:.1f}")
        # Asegurar último punto
        if pts and f"{pad + (seg[-1][0] - min_x) * scale:.1f},{size - (pad + (seg[-1][1] - min_y) * scale):.1f}" != pts[-1]:
            pts.append(f"{pad + (seg[-1][0] - min_x) * scale:.1f},{size - (pad + (seg[-1][1] - min_y) * scale):.1f}")
            
        svg_paths.append("M " + " L ".join(pts))
        
    path_d = " ".join(svg_paths)
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" width="{size}" height="{size}">
  <rect width="100%" height="100%" fill="#090d16" rx="10"/>
  <defs>
    <linearGradient id="gcodeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#00f2fe"/>
      <stop offset="100%" stop-color="#4facfe"/>
    </linearGradient>
  </defs>
  <path d="{path_d}" fill="none" stroke="url(#gcodeGrad)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>
  <rect x="8" y="8" width="54" height="20" rx="4" fill="#1e293b" opacity="0.8"/>
  <text x="35" y="22" text-anchor="middle" fill="#38bdf8" font-size="10" font-weight="bold" font-family="monospace">G-CODE</text>
  <text x="{size - 10}" y="{size - 10}" text-anchor="end" fill="#94a3b8" font-size="11" font-weight="600" font-family="monospace">{w:.1f} × {h:.1f} mm</text>
</svg>'''
    return svg, round(w, 1), round(h, 1)

