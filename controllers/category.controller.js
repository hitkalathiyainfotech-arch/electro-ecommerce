import mongoose from "mongoose";
import categoryModel from "../models/category.model.js";
import { checkRequired, sendBadRequestResponse, sendErrorResponse, sendSuccessResponse } from "../utils/response.utils.js"
import { deleteFromS3, updateS3, uploadToS3 } from "../utils/s3Service.js";

/**
 * 
 * @param {import("express").Request} req 
 * @param {import("express").Response} res 
 * @returns 
 */

export const createNewCategory = async (req, res) => {
  try {
    const { name } = req.body;
    const { _id } = req.user;
    const categoryImage = req.file;


    if (!name) {
      return sendBadRequestResponse(res, "Category Name is Required")
    }

    if (!categoryImage) {
      return sendBadRequestResponse(res, "Category Image is Required")
    }
    let img = null;
    if (categoryImage) {
      img = await uploadToS3(categoryImage, "uploads")
    }

    const category = await categoryModel.create({
      name: name,
      image: img,
      sellerId: _id
    })

    await category.save();

    return sendSuccessResponse(res, "Category Add Successfully", category);

  } catch (error) {
    console.log("error while create category : " + error.message)
    return sendErrorResponse(res, 500, "error while create category", error)
  }
}

export const getAllCategory = async (req, res) => {
  try {
    const category = await categoryModel.find({})
      .populate("sellerId", "firstName mobileNo email avatar role")
      .sort({ createdAt: -1 })

    return sendSuccessResponse(res, "All Category Featched Successfully", {
      total: category.length,
      category
    })
  } catch (error) {
    console.log("error While Get All Category" + error.message)
    return sendErrorResponse(res, 500, "error While Get All Category", error)
  }
}

export const getCategoryById = async (req, res) => {
  try {
    const { id } = req.params;

    const category = await categoryModel.find({ _id: id })
      .populate("sellerId", "firstName mobileNo email avatar role")
      .sort({ createdAt: -1 })

    return sendSuccessResponse(res, "All Category Featched Successfully", {
      total: category.length,
      category
    })

  } catch (error) {
    console.log("error while getCategoryById", error.message)
    return sendErrorResponse(res, 500, "error while getCategoryById", error)
  }
}

export const updateCategory = async (req, res) => {
  try {
    const { name } = req.body;
    const { id } = req.params;

    let category = await categoryModel.findOne({ _id: id });
    if (!category) {
      return sendErrorResponse(res, 404, "Category not found");
    }

    let img = null;

    if (req.file) {
      const key = category.image.split(".amazonaws.com/")[1];
      img = await updateS3(key, req.file);
    }

    category.name = name || category.name;
    category.image = img || category.image;

    await category.save();

    return sendSuccessResponse(res, "Category updated", category);
  } catch (error) {
    console.log("Error while update Category");
    return sendErrorResponse(res, 500, "Error while update Category", error);
  }
};

export const deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendBadRequestResponse(res, "somthing went wrong in ID")
    }


    const category = await categoryModel.findByIdAndDelete({ _id: id });
    let key = String(category.image).split(".amazonaws.com/")[1];
    await deleteFromS3(key)

    return sendSuccessResponse(res, "Category deleted Successfully", category)

  } catch (error) {
    console.log("error while Delete Category", error.message);
    return sendErrorResponse(res, 500, "error while Delete Category", error)
  }
}

/**
 * 
 * @param {import("express").Request} req 
 * @param {import("express").Response} res 
 * @returns 
 */
export const searchCategory = async (req, res) => {
  try {
    const { q, page = 1, limit = 20 } = req.query;
    if (!q) {
      return sendBadRequestResponse(res, "q is required for request");
    }

    const skip = (page - 1) * limit;

    const result = await categoryModel.find({
      name: { $regex: q, $options: "i" }
    }).skip(skip)
      .limit(Number(limit))
      .sort({ createdAt: -1 })

    return sendSuccessResponse(res, "Search result featched Successfully", {
      total: result.length,
      result
    })
  } catch (error) {
    console.log("Error while Search category", error.message);
    return sendErrorResponse(res, 500, "Error while Search category", error);
  }
}