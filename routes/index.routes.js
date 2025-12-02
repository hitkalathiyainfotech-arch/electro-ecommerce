import express from 'express';
import { addNewAddress, createUser, deleteUserAddress, forgotPassword, getAllCountry, getAllUserAddress, getUserAddressById, getUserProfile, resetPassword, selectCountry, selectUserAddress, socialLogin, updateUserAddress, userLogin, verifyOtp } from '../controllers/user.controller.js';
import { sellerAndAdminAuth, UserAuth } from '../middleware/auth.middleware.js';
import { createAdminController, newSellerController, sellerForgetPasswordController, sellerLoginController, sellerPasswordChangeController, sellerPasswordResetController, sellerVerifyForgetOtpController, updateProfile, verifySellerMobileOtpController } from '../controllers/seller.controller.js';
import { UserAuth } from '../middleware/auth.middleware.js';
import { sendResponse, sendSuccessResponse } from '../utils/response.utils.js';
import { deleteFromS3, deleteManyFromS3, listBucketObjects, updateS3, uploadToS3 } from '../utils/s3Service.js';
import { upload } from '../helper/imageUplode.js';

const indexRoutes = express.Router();

indexRoutes.post("/createUser", createUser);
indexRoutes.post("/userLogin", userLogin);

indexRoutes.post("/socialLogin", socialLogin)

indexRoutes.post("/forgotPassword", forgotPassword)
indexRoutes.post("/verifyOtp", verifyOtp)
indexRoutes.post("/resetPassword", resetPassword)

indexRoutes.get("/getAllCountry", getAllCountry);
indexRoutes.get("/selectCountry/:country", UserAuth, selectCountry);

indexRoutes.post("/addNewAddress", UserAuth, addNewAddress);
indexRoutes.patch("/updateUserAddress/:id", UserAuth, updateUserAddress);
indexRoutes.get("/getAllUserAddress", UserAuth, getAllUserAddress);
indexRoutes.get("/getUserAddressById/:id", UserAuth, getUserAddressById);
indexRoutes.delete("/deleteUserAddress/:id", UserAuth, deleteUserAddress);
indexRoutes.post("/selectUserAddress", UserAuth, selectUserAddress);

indexRoutes.get("/getUserProfile", UserAuth, getUserProfile)

//seller.router.js
indexRoutes.post("/new/admin", createAdminController)
indexRoutes.post("/new/seller", newSellerController)
indexRoutes.post("/verify/seller/otp", verifySellerMobileOtpController)
indexRoutes.post("/seller/login", sellerLoginController)
// indexRoutes.post("/seller/updateProfile", sellerAndAdminAuth, upload.single("avatar"), updateProfile)
indexRoutes.post("/seller/forget/password", sellerForgetPasswordController);
indexRoutes.post("/seller/verify/forget/password", sellerVerifyForgetOtpController);
indexRoutes.post("/seller/reset/password", sellerPasswordResetController);
indexRoutes.post("/seller/change/password", sellerAndAdminAuth, sellerPasswordChangeController);


//aws
indexRoutes.get("/list", async (req, res) => {
  try {
    const images = await listBucketObjects();

    return sendSuccessResponse(res, "Get all images successfully", {
      total: images.length,
      images: images.map((e, index) => { return `${e.url}` })
    })
  } catch (error) {
    console.log("ERROR WHIWL GET ALL IMAGE FROM S3");
    return sendResponse(res, 500, "ERROR WHILE GET ALL IMAGE FROM S3", error)
  }
});

indexRoutes.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return sendResponse(res, 400, "File required");

    const url = await uploadToS3(file, "uploads");
    return sendSuccessResponse(res, "Uploaded successfully", { url });
  } catch (error) {
    return sendResponse(res, 500, "Upload error", error);
  }
});

indexRoutes.delete("/delete", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return sendResponse(res, 400, "URL required");

    const key = url.split(".amazonaws.com/")[1];
    if (!key) return sendResponse(res, 400, "Invalid S3 URL");

    await deleteFromS3(key);

    return sendSuccessResponse(res, "Deleted successfully", { key });
  } catch (error) {
    return sendResponse(res, 500, "Delete error", error);
  }
});


indexRoutes.delete("/deleteMany", async (req, res) => {
  try {
    const { images } = req.body;
    if (!Array.isArray(images) || !images.length) return sendResponse(res, 400, "URLs array required");

    const keys = images.map(url => {
      const key = String(url).split(".amazonaws.com/")[1];
      return key;
    }).filter(Boolean);

    if (!keys.length) return sendResponse(res, 400, "Invalid S3 URLs");

    await deleteManyFromS3(keys);

    return sendSuccessResponse(res, "Deleted multiple files", {
      deleted: keys.length,
      keys
    });
  } catch (error) {
    return sendResponse(res, 500, "Delete many error", error);
  }
});


indexRoutes.put("/update", upload.single("file"), async (req, res) => {
  try {
    const { oldKey } = req.body;
    const newFile = req.file;

    if (!oldKey || !newFile) {
      return sendResponse(res, 400, "oldKey and new file required");
    }

    let key = oldKey;

    if (oldKey.includes(".amazonaws.com")) {
      key = oldKey.split(".amazonaws.com/")[1];
    }

    if (!key) {
      return sendResponse(res, 400, "Invalid S3 URL or key");
    }

    const url = await updateS3(key, newFile, "uploads");

    return sendSuccessResponse(res, "Updated successfully", { url });
  } catch (error) {
    return sendResponse(res, 500, "Update error", error);
  }
});

export default indexRoutes;