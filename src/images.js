export async function validateBarFile(file) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || !file.size || file.size > 5 * 1024 * 1024) throw Error('Use PNG, JPG ou WebP de até 5 MB.');
  let image;
  try { image = await createImageBitmap(file); }
  catch { throw Error('Não foi possível ler a imagem.'); }
  try { if (image.width !== 2172 || image.height !== 724) throw Error('A barra deve ter exatamente 2172 × 724 pixels.'); }
  finally { image.close(); }
}
