-- Group payloads changed shape (raw set rows instead of server metrics; groups
-- contract §4.2, §5). group_cache is a disposable cache of server data, so it is
-- emptied once rather than rendering a payload in the old shape.
DELETE FROM `group_cache`;
