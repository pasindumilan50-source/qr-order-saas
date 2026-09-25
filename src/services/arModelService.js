import { supabase } from '../supabase/config';

const BUCKET = 'ar-models';

export const AR_FORMATS = {
  glb: { ext: 'glb', label: 'GLB', mime: 'model/gltf-binary', maxBytes: 25 * 1024 * 1024 },
  usdz: { ext: 'usdz', label: 'USDZ', mime: 'model/vnd.usdz+zip', maxBytes: 15 * 1024 * 1024 },
};
export const AR_RECOMMENDED_MB = 5;

async function readMagic(file) {
  const buf = await file.slice(0, 4).arrayBuffer();
  return Array.from(new Uint8Array(buf));
}

// Validates extension, size and the file's real signature (GLB starts with
// "glTF", USDZ is a ZIP archive). Throws a friendly Error when invalid.
export async function validateModelFile(format, file) {
  const spec = AR_FORMATS[format];
  if (!spec) throw new Error('Unknown model format.');
  if (!file) throw new Error('No file selected.');
  if (!file.name.toLowerCase().endsWith(`.${spec.ext}`)) {
    throw new Error(`Please choose a .${spec.ext} file.`);
  }
  if (file.size === 0) throw new Error('That file is empty.');
  if (file.size > spec.maxBytes) {
    throw new Error(`${spec.label} file must be smaller than ${spec.maxBytes / 1024 / 1024} MB.`);
  }
  const m = await readMagic(file);
  const isGlb = m[0] === 0x67 && m[1] === 0x6c && m[2] === 0x54 && m[3] === 0x46; // "glTF"
  const isZip = m[0] === 0x50 && m[1] === 0x4b; // "PK"
  if (format === 'glb' && !isGlb) throw new Error('This does not look like a valid .glb file.');
  if (format === 'usdz' && !isZip) throw new Error('This does not look like a valid .usdz file.');
}

const pathFor = (restaurantId, menuItemId, format) =>
  `${restaurantId}/${menuItemId}/model.${AR_FORMATS[format].ext}`;

// Uploads (or overwrites) model.{glb|usdz} for one menu item. Overwriting the
// same predictable path means a replace never leaves an orphan file, and a
// failed upload leaves the previous model untouched.
export async function uploadModel(restaurantId, menuItemId, format, file) {
  await validateModelFile(format, file);
  const path = pathFor(restaurantId, menuItemId, format);
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    upsert: true,
    cacheControl: '3600',
    contentType: AR_FORMATS[format].mime,
  });
  if (error) throw error;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  // Cache-buster so customers get the new file right after a replace.
  return `${data.publicUrl}?v=${Date.now()}`;
}

export async function removeModelFiles(restaurantId, menuItemId, formats = ['glb', 'usdz']) {
  const paths = formats.map((f) => pathFor(restaurantId, menuItemId, f));
  const { error } = await supabase.storage.from(BUCKET).remove(paths);
  if (error) throw error;
}

// Applies the admin's model changes for one item and returns the DB patch.
// Order: upload new files -> caller updates DB -> caller deletes removed files.
export async function prepareModelChanges(restaurantId, menuItemId, changes) {
  const patch = {};
  const toDelete = [];
  for (const format of ['glb', 'usdz']) {
    const c = changes?.[format];
    const key = format === 'glb' ? 'modelGlbUrl' : 'modelUsdzUrl';
    if (c?.file) patch[key] = await uploadModel(restaurantId, menuItemId, format, c.file);
    else if (c?.remove) {
      patch[key] = '';
      toDelete.push(format);
    }
  }
  return { patch, toDelete };
}
