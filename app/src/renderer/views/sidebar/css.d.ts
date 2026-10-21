// CSS files imported as text (esbuild import attribute `with { type: "text" }`).
declare module "*.css" {
  const text: string;
  export default text;
}
