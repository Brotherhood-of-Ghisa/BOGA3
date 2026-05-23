alter table app_public.gyms
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists coordinate_accuracy_m double precision,
  add column if not exists coordinates_updated_at bigint;

alter table app_public.gyms
  drop constraint if exists gyms_latitude_range,
  drop constraint if exists gyms_longitude_range,
  drop constraint if exists gyms_coordinate_accuracy_non_negative,
  drop constraint if exists gyms_coordinates_updated_at_non_negative,
  drop constraint if exists gyms_coordinate_shape;

alter table app_public.gyms
  add constraint gyms_latitude_range
    check (latitude is null or (latitude >= -90 and latitude <= 90)),
  add constraint gyms_longitude_range
    check (longitude is null or (longitude >= -180 and longitude <= 180)),
  add constraint gyms_coordinate_accuracy_non_negative
    check (coordinate_accuracy_m is null or coordinate_accuracy_m >= 0),
  add constraint gyms_coordinates_updated_at_non_negative
    check (coordinates_updated_at is null or coordinates_updated_at >= 0),
  add constraint gyms_coordinate_shape
    check (
      (
        latitude is null
        and longitude is null
        and coordinate_accuracy_m is null
        and coordinates_updated_at is null
      )
      or (
        latitude is not null
        and longitude is not null
        and coordinate_accuracy_m is not null
        and coordinates_updated_at is not null
      )
    );

create or replace function app_public.sync_apply_gym_coordinates_from_ingested_event()
returns trigger
language plpgsql
set search_path = app_public, public, extensions
as $$
declare
  v_has_coordinate_payload boolean;
  v_all_coordinate_keys_present boolean;
  v_latitude double precision;
  v_longitude double precision;
  v_coordinate_accuracy_m double precision;
  v_coordinates_updated_at bigint;
begin
  if NEW.entity_type <> 'gyms' or NEW.event_type <> 'upsert' then
    return NEW;
  end if;

  v_has_coordinate_payload :=
    NEW.payload ?| array['latitude', 'longitude', 'coordinate_accuracy_m', 'coordinates_updated_at_ms'];

  if not v_has_coordinate_payload then
    return NEW;
  end if;

  v_all_coordinate_keys_present :=
    NEW.payload ? 'latitude'
    and NEW.payload ? 'longitude'
    and NEW.payload ? 'coordinate_accuracy_m'
    and NEW.payload ? 'coordinates_updated_at_ms';

  if not v_all_coordinate_keys_present then
    raise exception 'gym coordinate payload must include latitude, longitude, coordinate_accuracy_m, and coordinates_updated_at_ms'
      using errcode = '22023';
  end if;

  if NEW.payload ->> 'latitude' is null
     and NEW.payload ->> 'longitude' is null
     and NEW.payload ->> 'coordinate_accuracy_m' is null
     and NEW.payload ->> 'coordinates_updated_at_ms' is null then
    update app_public.gyms
       set latitude = null,
           longitude = null,
           coordinate_accuracy_m = null,
           coordinates_updated_at = null
     where id = NEW.entity_id
       and owner_user_id = NEW.owner_user_id;

    return NEW;
  end if;

  if NEW.payload ->> 'latitude' is null
     or NEW.payload ->> 'longitude' is null
     or NEW.payload ->> 'coordinate_accuracy_m' is null
     or NEW.payload ->> 'coordinates_updated_at_ms' is null then
    raise exception 'gym coordinate payload must set all coordinate fields or clear all coordinate fields'
      using errcode = '22023';
  end if;

  v_latitude := (NEW.payload ->> 'latitude')::double precision;
  v_longitude := (NEW.payload ->> 'longitude')::double precision;
  v_coordinate_accuracy_m := (NEW.payload ->> 'coordinate_accuracy_m')::double precision;
  v_coordinates_updated_at := (NEW.payload ->> 'coordinates_updated_at_ms')::bigint;

  if v_latitude < -90 or v_latitude > 90 then
    raise exception 'latitude must be between -90 and 90' using errcode = '22023';
  end if;

  if v_longitude < -180 or v_longitude > 180 then
    raise exception 'longitude must be between -180 and 180' using errcode = '22023';
  end if;

  if v_coordinate_accuracy_m < 0 then
    raise exception 'coordinate_accuracy_m must be non-negative' using errcode = '22023';
  end if;

  if v_coordinates_updated_at < 0 then
    raise exception 'coordinates_updated_at_ms must be non-negative' using errcode = '22023';
  end if;

  update app_public.gyms
     set latitude = v_latitude,
         longitude = v_longitude,
         coordinate_accuracy_m = v_coordinate_accuracy_m,
         coordinates_updated_at = v_coordinates_updated_at
   where id = NEW.entity_id
     and owner_user_id = NEW.owner_user_id;

  return NEW;
end;
$$;

drop trigger if exists sync_ingested_events_apply_gym_coordinates on app_public.sync_ingested_events;
create trigger sync_ingested_events_apply_gym_coordinates
after insert on app_public.sync_ingested_events
for each row
execute function app_public.sync_apply_gym_coordinates_from_ingested_event();
