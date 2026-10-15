"use client";

import Image from "next/image";
import Link from "next/link";
import { SITE_NAME } from "@/lib/site-config.mjs";
import { useStudioPreferences } from "./StudioPreferences";

export default function BrandLogo() {
  const { animateLogo } = useStudioPreferences();

  return <div className="website-brand">
    <Link className="brand" href="/" aria-label={`${SITE_NAME} home`}>
      <picture className="comet-mark">
        <source media="(prefers-reduced-motion: reduce)" srcSet="/brand/pixel-comet-static.svg" />
        <Image src={animateLogo ? "/brand/pixel-comet-animated.svg" : "/brand/pixel-comet-static.svg"}
          alt="" aria-hidden="true" width={60} height={36} unoptimized />
      </picture>
      <span className="brand-wordmark">Pixels<span>Draw</span></span>
    </Link>
  </div>;
}
