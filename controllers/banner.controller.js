import mongoose from "mongoose";
import bannerModel from "../models/banner.model.js";
import { sendBadRequestResponse, sendErrorResponse, sendSuccessResponse } from "../utils/response.utils.js";
import { deleteFromS3, uploadToS3 } from "../utils/s3Service.js";

export const createHeroBanner = async (req, res) => {
  try {
    const files = req.files;
    const { name } = req.body;

    if (!files || files.length === 0)
      return sendBadRequestResponse(res, "No banner images provided");

    const uploaded = await Promise.all(files.map((file) => uploadToS3(file)));

    const banners = uploaded.map((file) => ({ banner: file }));

    const data = await bannerModel.create({
      name: name || "TEST",
      banner: banners
    });

    return sendSuccessResponse(res, "Hero Banner created successfully", data);
  } catch (error) {
    return sendErrorResponse(res, 500, "Error while createHeroBanner", error);
  }
};

export const getAllBanners = async (req, res) => {
  try {
    const banner = await bannerModel.find({});

    return sendSuccessResponse(res, "banner Fetched Successfullty", banner)
  } catch (error) {
    console.log("Error while Get ALl Banner", error);
    return sendErrorResponse(res, 500, "Error while Get ALl Banner", error)
  }
}

export const updateBanner = async (req, res) => {
  try {
    const { name } = req.body
    const files = req.files
    const { id } = req.params

    if (!id) return sendBadRequestResponse(res, "Banner ID required")
    if (!mongoose.Types.ObjectId.isValid(id)) return sendBadRequestResponse(res, "Invalid Banner ID")

    const banner = await bannerModel.findById(id)
    if (!banner) return sendBadRequestResponse(res, "Banner not found")

    if (banner.banner.length > 0) {
      for (const b of banner.banner) {
        const key = b.banner.split(".com/")[1]
        await deleteFromS3(key)
      }
    }

    const newBanners = []
    if (files && files.length > 0) {
      for (const file of files) {
        const uploaded = await uploadToS3(file, "banners")
        newBanners.push({ banner: uploaded })
      }
    }

    if (name) banner.name = name
    banner.banner = newBanners

    await banner.save()

    return sendSuccessResponse(res, "Banner updated", banner)
  } catch (error) {
    console.log("Error while updateBanner", error)
    return sendErrorResponse(res, 500, "Error while updateBanner", error)
  }
}

export const deleteBanner = async (req, res) => {
  try {
    const { id } = req.params

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return sendBadRequestResponse(res, "id is required or invalid")
    }

    const banner = await bannerModel.findById(id)
    if (!banner) return sendBadRequestResponse(res, "Banner not found")
    if (banner.banner && banner.banner.length > 0) {
      for (const b of banner.banner) {
        const key = b.banner.split(".amazonaws.com/")[1]

        await deleteFromS3(key)
      }
    }

    const deleted = await bannerModel.findByIdAndDelete(id)

    return sendSuccessResponse(res, "Banner deleted successfully", deleted)
  } catch (error) {
    console.log("Error while deleteBanner", error)
    return sendErrorResponse(res, 500, "Error while deleteBanner", error)
  }
}
