import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/datasheets/$file")({
  component: () => null,
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const { serveDatasheet } = await import("@/lib/server/datasheet-file");
          return await serveDatasheet(request, params.file);
        } catch (err) {
          console.error("[datasheet]", err);
          return new Response("Tuotekorttia ei voitu ladata", { status: 500 });
        }
      },
    },
  },
});
