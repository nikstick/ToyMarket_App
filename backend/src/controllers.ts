import type { RowDataPacket } from "mysql2/promise";
import { Cache } from "node-ts-cache";
import ipc from "node-ipc";

import { Spruton } from "common/dist/controllers.js";

import { config } from "./config.js";
import { DBSession } from "./db.js";
import { cacheStorage, uselessFront } from "./utils.js";

export var spruton = new Spruton(config);

class Storage {
  @Cache(cacheStorage, {ttl: 120, isLazy: false})
  public async getProductsView(): Promise<RowDataPacket[]> {
    for await (const session of DBSession.ctx()) {
      let value = await session.fetchProductsView();
      return value;
    }
  }

  @Cache(cacheStorage, {ttl: 120, isLazy: false})
  public async getProductsByCategoryView(): Promise<object> {
    let products = structuredClone(await this.getProductsView());

    let productsByCategory: {[key: number]: {categoryName: string, products: any[]}} = {};
    products.forEach((product) => {
      const categoryID = product.categoryID;
      uselessFront.product(product);

      if (!productsByCategory[categoryID]) {
        productsByCategory[categoryID] = {
          categoryName: product.categoryName,
          products: [],
        };
      }
      productsByCategory[categoryID].products.push(product);
    });
    let categoriesList = Object.values(productsByCategory);

    // new category
    const newProducts = [];
    categoriesList.forEach(
      (category) => {
        category.products.forEach(
          (product) => {
            if (product.isNew == "true") {
              newProducts.push(product);
            }
          }
        )
      }
    );
    categoriesList.push({categoryName: "Новинки", products: newProducts});

    return categoriesList;
  }
}

export var storage = new Storage();

ipc.config.id = "backend";
ipc.connectTo("bot");
