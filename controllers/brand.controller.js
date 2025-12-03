import brandModel from "../models/brand.model.js";
import { sendBadRequestResponse, sendErrorResponse, sendSuccessResponse } from "../utils/response.utils.js";
import { uploadToS3 } from "../utils/s3Service.js";

export const createBrand = async (req, res) => {
  try {
    const { brandName, categories } = req.body;
    const createdBy = req.user._id;

    if (!brandName) {
      return res.status(400).json({
        success: false,
        message: "Brand name is required"
      });
    }

    const exists = await brandModel.findOne({ brandName });
    if (exists) {
      return res.status(409).json({
        success: false,
        message: "Brand already exists"
      });
    }

    let brandImage = null;
    if (req.file) {
      brandImage = await uploadToS3(req.file);
    }

    const brand = await brandModel.create({
      brandName,
      brandImage,
      categories: categories ? JSON.parse(categories) : [],
      createdBy
    });

    return res.status(201).json({
      success: true,
      message: "Brand created",
      result: brand
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

export const getAllBrands = async (req, res) => {
  try {
    const brands = await brandModel
      .find({})
      .populate({
        path: "categories",
        select: "-updatedAt -__v",
        populate: {
          path: "createdBy",
          select: "firstName email avatar role"
        }
      })
      .populate("createdBy", "firstName mobileNo email avatar role")
      .sort({ createdAt: -1 });

    return sendSuccessResponse(res, "All brands featched successfully", brands);
  } catch (error) {
    console.log("ERROR WHILE get all Brand")
    return sendSuccessResponse(res, 500, "ERROR WHILE get all Brand", error)
  }
}

export const getBrandsById = async (req, res) => {
  try {
    const { id } = req.params;

    const brands = await brandModel
      .find({ _id: id })
      .populate({
        path: "categories",
        select: "-updatedAt -__v",
        populate: {
          path: "createdBy",
          select: "firstName email avatar role"
        }
      })
      .populate("createdBy", "firstName mobileNo email avatar role")
      .sort({ createdAt: -1 });

    return sendSuccessResponse(res, "brands featched successfully", brands);

  } catch (error) {
    console.log("Error while get brand by id" + error.message);
    return sendErrorResponse(res, 500, "Error while get brand By Id", error)
  }
}

export const updateBrandById = async (req, res) => {
  try {
    const { id } = req.params;
    const { brandName, categories } = req.body;
    const updatedBy = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid brand ID" });
    }

    const brand = await brandModel.findById(id);
    if (!brand) {
      return res.status(404).json({ success: false, message: "Brand not found" });
    }

    if (brandName && brandName !== brand.brandName) {
      const exists = await brandModel.findOne({ brandName, _id: { $ne: id } });
      if (exists) {
        return res.status(409).json({ success: false, message: "Brand name already exists" });
      }
      brand.brandName = brandName;
    }

    if (req.file) {
      if (brand.brandImage) {
        const key = String(brand.brandImage).split(".amazonaws.com/")[1];
        if (key) await deleteS3File(key);
      }
      const img = await uploadToS3(req.file, "brands");
      brand.brandImage = img;
    }

    if (categories !== undefined) {
      try {
        brand.categories = Array.isArray(categories) ? categories : JSON.parse(categories);
      } catch {
        return res.status(400).json({ success: false, message: "Categories must be a valid JSON array" });
      }
    }

    if (brand.schema.path("updatedBy")) {
      brand.updatedBy = updatedBy;
    }

    await brand.save();

    return res.status(200).json({
      success: true,
      message: "Brand updated successfully",
      result: brand
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const searchBrand = async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || q.trim() === "") {
      return sendBadRequestResponse(res, "Search query (q) is required");
    }

    const searchQuery = q.trim();

    const result = await brandModel.find({
      brandName: { $regex: searchQuery, $options: "i" }
    })
      .sort({ createdAt: -1 });

    const total = await brandModel.countDocuments({
      brandName: { $regex: searchQuery, $options: "i" }
    });

    return sendSuccessResponse(res, "Search result fetched successfully", {
      total,
      result
    });

  } catch (error) {
    console.error("Error while searching brand:", error.message);
    return sendErrorResponse(res, 500, "Error while searching brand", error.message);
  }
};