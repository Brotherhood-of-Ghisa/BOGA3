PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_gyms` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`name` text NOT NULL,
	`latitude` real,
	`longitude` real,
	`coordinate_accuracy_m` real,
	`coordinates_updated_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "gyms_latitude_range" CHECK("__new_gyms"."latitude" is null or ("__new_gyms"."latitude" >= -90 and "__new_gyms"."latitude" <= 90)),
	CONSTRAINT "gyms_longitude_range" CHECK("__new_gyms"."longitude" is null or ("__new_gyms"."longitude" >= -180 and "__new_gyms"."longitude" <= 180)),
	CONSTRAINT "gyms_coordinate_accuracy_non_negative" CHECK("__new_gyms"."coordinate_accuracy_m" is null or "__new_gyms"."coordinate_accuracy_m" >= 0),
	CONSTRAINT "gyms_coordinates_updated_at_non_negative" CHECK("__new_gyms"."coordinates_updated_at" is null or "__new_gyms"."coordinates_updated_at" >= 0),
	CONSTRAINT "gyms_coordinate_shape" CHECK((
        "__new_gyms"."latitude" is null
        and "__new_gyms"."longitude" is null
        and "__new_gyms"."coordinate_accuracy_m" is null
        and "__new_gyms"."coordinates_updated_at" is null
      ) or (
        "__new_gyms"."latitude" is not null
        and "__new_gyms"."longitude" is not null
        and "__new_gyms"."coordinate_accuracy_m" is not null
        and "__new_gyms"."coordinates_updated_at" is not null
      ))
);
--> statement-breakpoint
INSERT INTO `__new_gyms`("id", "name", "latitude", "longitude", "coordinate_accuracy_m", "coordinates_updated_at", "created_at", "updated_at") SELECT "id", "name", null, null, null, null, "created_at", "updated_at" FROM `gyms`;--> statement-breakpoint
DROP TABLE `gyms`;--> statement-breakpoint
ALTER TABLE `__new_gyms` RENAME TO `gyms`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `gyms_name_idx` ON `gyms` (`name`);--> statement-breakpoint
ALTER TABLE `sync_runtime_state` ADD `seeds_applied_at` integer;
