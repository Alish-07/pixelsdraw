"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { SITE_NAME } from "@/lib/site-config.mjs";

export default function BrandLogo() {
  const [paused, setPaused] = useState(false);

  return <div className="website-brand">
    <Link className="brand" href="/" aria-label={`${SITE_NAME} home`}>
      <picture className="comet-mark">
        <source media="(prefers-reduced-motion: reduce)" srcSet="/brand/pixel-comet-static.svg" />
        <Image src={paused ? "/brand/pixel-comet-static.svg" : "/brand/pixel-comet-animated.svg"}
          alt="" aria-hidden="true" width={60} height={36} unoptimized />
      </picture>
      <span className="brand-wordmark">Pixels<span>Draw</span></span>
    </Link>
    <button className="brand-animation-toggle" type="button" aria-pressed={paused}
      aria-label={paused ? "Play logo animation" : "Pause logo animation"}
      title={paused ? "Play logo animation" : "Pause logo animation"}
      onClick={() => setPaused(value => !value)}>
      <span aria-hidden="true">{paused ? "▶" : "Ⅱ"}</span>
    </button>
  </div>;
}
