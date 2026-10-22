import { buildApp } from "./app.js";
import { config } from "./config.js";

const app = await buildApp();
await app.listen({ host: config.API_HOST, port: config.API_PORT });
