import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { browserRouter } from "../../server/controllers/static/browser";

// create an isolated static app
const createApp = (): express.Express => {
  const app = express();
  app.use(browserRouter);
  return app;
};

// Android App Links document
describe("Android App Links", () => {
  // publish every Play signing certificate
  it("serves both signing certificates from the required path", async () => {
    const response = await request(createApp())
      .get("/.well-known/assetlinks.json")
      .expect("content-type", /application\/json/)
      .expect(200);

    expect(response.body).toEqual([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: "fyi.ferry",
          sha256_cert_fingerprints: [
            "83:33:A0:5D:80:9C:57:19:7E:9B:64:17:7C:4F:08:8A:9F:AD:91:76:97:D2:C0:52:12:6C:87:80:63:A0:31:F2",
            "DA:FB:7E:B4:7F:20:3F:EF:78:F1:A5:DB:72:4B:1D:81:27:A8:0E:CA:4B:ED:0E:3D:03:60:0C:8D:40:0A:7A:D3",
          ],
        },
      },
    ]);
  });
});
