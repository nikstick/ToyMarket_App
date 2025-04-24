CREATE FULLTEXT INDEX ${product.article}_fts ON ${product}(${product.article});
CREATE FULLTEXT INDEX ${product.name}_fts ON ${product}(${product.name});
/* not relevant
CREATE FULLTEXT INDEX ${product.keywords}_fts ON ${product}(${product.keywords});
*/

/* real */
CREATE FULLTEXT INDEX field_221_fts ON app_entity_26(field_221);
CREATE FULLTEXT INDEX field_387_fts ON app_entity_26(field_387);

/* both */
CREATE FULLTEXT INDEX name_fts ON app_global_lists_choices(name);
