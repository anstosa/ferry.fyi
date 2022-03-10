import { auth0 } from "~/lib/auth0";
import { isArray } from "shared/lib/arrays";
import { Router } from "express";

const userRouter = Router();

userRouter.get("/", async (request, response) => {
  let user = await auth0.getUser({ id: response.locals.user.sub });
  if (isArray(user)) {
    user = user[0];
  }
  return response.send(user);
});

userRouter.post("/", async (request, response) => {
  if (request.body.app_metadata) {
    await auth0.updateAppMetadata(
      { id: response.locals.user.sub },
      request.body.app_metadata
    );
  }
  return response.send();
});

export { userRouter };
