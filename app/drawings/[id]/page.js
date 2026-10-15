import DrawingLibrary from "@/components/DrawingLibrary";
export const metadata = { title: "Edit drawing · PixelsDraw" };
export default async function Page({ params }) {
  const { id } = await params;
  return <main id="main-content"><DrawingLibrary id={id} /></main>;
}
