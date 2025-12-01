import express from 'express';
import { createUser, forgotPassword, getAllCountry, resetPassword, selectCountry, socialLogin, userLogin, verifyOtp } from '../controllers/user.controller.js';
import { UserAuth } from '../middleware/auth.middleware.js';

const indexRoutes = express.Router();

indexRoutes.post("/createUser", createUser);
indexRoutes.post("/userLogin", userLogin);

indexRoutes.post("/socialLogin", socialLogin)

indexRoutes.post("/forgotPassword", forgotPassword)
indexRoutes.post("/verifyOtp", verifyOtp)
indexRoutes.post("/resetPassword", resetPassword)

indexRoutes.get("/getAllCountry", getAllCountry);
indexRoutes.get("/selectCountry/:country", UserAuth, selectCountry);

export default indexRoutes;