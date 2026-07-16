export default {
  async fetch(): Promise<Response> {
    // SPA assets are served by Workers static assets.
    // API lives on the separate penny-edge-api Worker.
    return new Response(null, { status: 404 });
  },
};
