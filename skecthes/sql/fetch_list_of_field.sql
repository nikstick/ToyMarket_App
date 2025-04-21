SET @field_id = 319
SELECT * FROM app_global_lists_choices WHERE lists_id = (SELECT configuration->>'$.use_global_list' FROM `app_fields` WHERE id = @field_id)
