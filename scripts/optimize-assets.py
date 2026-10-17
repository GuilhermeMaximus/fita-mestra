"""Build lossless WebP assets. Requires Pillow; originals are preserved."""
from pathlib import Path
from PIL import Image

target = Path('assets/optimized')
target.mkdir(exist_ok=True)
for source in Path('assets').glob('*.png'):
    if source.stem == 'vhs-hero':
        with Image.open(source) as artwork:
            artwork.save(target / 'vhs-hero.webp', 'WEBP', quality=88, method=6)
        continue
    with Image.open(source) as original:
        destination = target / (source.stem + '.webp')
        original.save(destination, 'WEBP', lossless=True, exact=True, method=6)
        with Image.open(destination) as result:
            assert original.convert('RGBA').tobytes() == result.convert('RGBA').tobytes()
print('WebP gerados e verificados pixel a pixel.')
