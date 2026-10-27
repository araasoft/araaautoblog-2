/** Reads an image file, scales it down so its longest side is <= max, returns a JPEG data URL. */
export function resizeImage(file, max = 2048, quality = 0.9) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    const url = URL.createObjectURL(file);
    im.onload = () => {
      const s = Math.min(1, max / Math.max(im.width, im.height));
      const c = document.createElement("canvas");
      c.width = Math.round(im.width * s);
      c.height = Math.round(im.height * s);
      c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", quality));
    };
    im.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read that image"));
    };
    im.src = url;
  });
}

/** Centre-crops an image to a square and returns a small JPEG data URL (for profile photos). */
export function squareImage(file, size = 192) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    const url = URL.createObjectURL(file);
    im.onload = () => {
      const c = document.createElement("canvas");
      c.width = c.height = size;
      const m = Math.min(im.width, im.height);
      c.getContext("2d").drawImage(im, (im.width - m) / 2, (im.height - m) / 2, m, m, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.82));
    };
    im.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read that image"));
    };
    im.src = url;
  });
}
