import re
import os

def parse_color(c):
    if not c: return "Color.Transparent"
    c = c.replace('"', '').replace("'", "")
    if c.startswith("rgba"):
        # rgba(0,0,0,0.3)
        m = re.match(r'rgba\((\d+),(\d+),(\d+),([\d.]+)\)', c)
        if m:
            r,g,b,a = m.groups()
            return f"Color({r}, {g}, {b}, {float(a) * 255:.0f})"
    if c.startswith("#"):
        if len(c) == 4:
            c = "#" + c[1]*2 + c[2]*2 + c[3]*2
        return f"Color(0xFF{c[1:].upper()})"
    if c == "white": return "Color.White"
    if c == "black": return "Color.Black"
    if c == "none": return "Color.Transparent"
    if c.startswith("url"):
        # We will handle brushes separately
        return c
    return f"Color.Red /* {c} */"

def jsx_to_kotlin(jsx):
    out = []
    
    # Simple regexes for Rect, Ellipse, Line, Circle, Path
    
    # Ellipse
    for m in re.finditer(r'<Ellipse\s+cx={([\d\.]+)}\s+cy={([\d\.]+)}\s+rx={([\d\.]+)}\s+ry={([\d\.]+)}\s+(.*?)(?:/>|></Ellipse>)', jsx):
        cx, cy, rx, ry = m.group(1), m.group(2), m.group(3), m.group(4)
        attrs = m.group(5)
        out.append(f"// Ellipse cx={cx} cy={cy} rx={rx} ry={ry} {attrs}")
        
        fill = re.search(r'fill="([^"]+)"', attrs) or re.search(r'fill={([^}]+)}', attrs)
        stroke = re.search(r'stroke="([^"]+)"', attrs) or re.search(r'stroke={([^}]+)}', attrs)
        strokeW = re.search(r'strokeWidth={([\d\.]+)}', attrs)
        
        # We will map these manually for now, or just let the script generate the structure.

    return "\n".join(out)

if __name__ == '__main__':
    with open('../mobile/components/VehicleTyreDiagram.tsx', 'r') as f:
        content = f.read()
    
    bodies = ["PickupBody", "CanterBody", "TriMixerBody", "ConcretePumpBody", "WheelLoaderBody"]
    for b in bodies:
        start = content.find(f"function {b}() {{")
        end = content.find("function ", start + 10)
        if end == -1: end = len(content)
        body_content = content[start:end]
        
        print(f"// --- {b} ---")
        # print(jsx_to_kotlin(body_content))
