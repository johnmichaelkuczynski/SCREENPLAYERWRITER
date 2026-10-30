import { Router, type IRouter } from "express";
import healthRouter from "./health";
import screenplayRouter from "./screenplay";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/screenplay", screenplayRouter);

export default router;
