"""Regenerate assets/branchloom.ico from the Branchloom mark geometry.

Optional developer tool: python -m pip install Pillow
The checked-in icon is used at runtime; Pillow is not an app dependency.
"""

from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "src/renderer/assets/branchloom-mark.svg"
OUTPUT = ROOT / "assets/branchloom.ico"
EXPECTED_PATH = 'd="M8 4v24m0-18h8l8-6M8 22h8l8 6M16 10v12"'


def main() -> None:
    # Abort if the canonical SVG changes; the ICO geometry must be reviewed then.
    if EXPECTED_PATH not in SOURCE.read_text(encoding="utf-8"):
        raise SystemExit("Mark geometry changed; update the icon drawing before regeneration.")

    scale = 32
    side = 32 * scale
    image = Image.new("RGBA", (side, side), "#e3eae4")
    draw = ImageDraw.Draw(image)
    ink = "#275d48"
    width = round(2.25 * scale)
    radius = width / 2

    def stroke(points: list[tuple[int, int]]) -> None:
        scaled = [(x * scale, y * scale) for x, y in points]
        draw.line(scaled, fill=ink, width=width, joint="curve")
        for x, y in scaled:
            draw.ellipse((round(x - radius), round(y - radius), round(x + radius), round(y + radius)), fill=ink)

    stroke([(8, 4), (8, 28)])
    stroke([(8, 10), (16, 10), (24, 4)])
    stroke([(8, 22), (16, 22), (24, 28)])
    stroke([(16, 10), (16, 22)])
    for x, y in ((24, 4), (24, 28)):
        r = 2.25 * scale
        draw.ellipse((round(x * scale - r), round(y * scale - r), round(x * scale + r), round(y * scale + r)), fill=ink)

    OUTPUT.parent.mkdir(exist_ok=True)
    image = image.resize((256, 256), Image.Resampling.LANCZOS)
    image.save(OUTPUT, format="ICO", sizes=[(16, 16), (20, 20), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print(OUTPUT)


if __name__ == "__main__":
    main()
