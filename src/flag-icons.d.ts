// The language switch's flags (flag-icons). Declared here so `tsc` passes on a fresh clone, before `next build` writes
// next-env.d.ts; Turbopack hands over an SVG from node_modules as a URL string (see flagSrc in shell/header.tsx).
declare module 'flag-icons/flags/4x3/*.svg' {
  const src: string | import('next/image').StaticImageData;
  export default src;
}
