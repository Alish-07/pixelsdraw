"use client";

import PixelCanvas from "./PixelCanvas";

// The local lab uses the same editor while keeping its draft isolated.
export default function ExperimentalPixelCanvas(props) {
  return <PixelCanvas {...props} storageScope="lab" />;
}
