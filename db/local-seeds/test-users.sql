PRAGMA foreign_keys = ON;

DELETE FROM users;

INSERT INTO users (
  id, username, email, bio, access_request_note, idp_email, idp_email_verified,
  avatar_url, email_public, avatar_object_key, avatar_thumb_key, avatar_hash,
  avatar_bytes, avatar_content_type, is_admin, is_moderator, is_approved,
  approved_at, approved_by_user_id, created_at, updated_at
) VALUES
-- Admins
('admin_01','Primary Admin','admin.primary@linksim.local','Bootstrap admin account','','admin.primary@linksim.local',1,'',1,NULL,NULL,NULL,NULL,NULL,1,0,1,'2026-03-01T09:00:00.000Z','seed','2026-03-01T09:00:00.000Z','2026-03-12T19:30:00.000Z'),
('admin_02','Nora Admin','nora.admin@linksim.local','Secondary admin','','nora.admin@linksim.local',1,'',1,NULL,NULL,NULL,NULL,NULL,1,0,1,'2026-03-05T11:00:00.000Z','seed','2026-03-05T11:00:00.000Z','2026-03-12T19:30:00.000Z'),

-- Moderators
('mod_01','Mika Moderator','mika.mod@linksim.local','Field moderator','','mika.mod@linksim.local',1,'',1,NULL,NULL,NULL,NULL,NULL,0,1,1,'2026-03-06T10:00:00.000Z','seed','2026-03-06T10:00:00.000Z','2026-03-12T19:30:00.000Z'),
('mod_02','Solveig Moderator','solveig.mod@linksim.local','Backup moderator','','solveig.mod@linksim.local',1,'',1,NULL,NULL,NULL,NULL,NULL,0,1,1,'2026-03-07T10:00:00.000Z','seed','2026-03-07T10:00:00.000Z','2026-03-12T19:30:00.000Z'),

-- Approved users
('user_01','Arne User','arne.user@linksim.local','Power user','','arne.user@linksim.local',1,'',1,NULL,NULL,NULL,NULL,NULL,0,0,1,'2026-03-08T08:00:00.000Z','mod_01','2026-03-08T08:00:00.000Z','2026-03-12T19:30:00.000Z'),
('user_02','Bente User','bente.user@linksim.local','Long-range tester','','bente.user@linksim.local',1,'',1,NULL,NULL,NULL,NULL,NULL,0,0,1,'2026-03-08T08:10:00.000Z','mod_01','2026-03-08T08:10:00.000Z','2026-03-12T19:30:00.000Z'),
('user_03','Carla User','carla.user@linksim.local','LoRa experimenter','','carla.user@linksim.local',1,'',1,NULL,NULL,NULL,NULL,NULL,0,0,1,'2026-03-08T08:20:00.000Z','mod_02','2026-03-08T08:20:00.000Z','2026-03-12T19:30:00.000Z'),
('user_04','Dag User','dag.user@linksim.local','Mesh relay planner','','dag.user@linksim.local',1,'',1,NULL,NULL,NULL,NULL,NULL,0,0,1,'2026-03-08T08:30:00.000Z','mod_02','2026-03-08T08:30:00.000Z','2026-03-12T19:30:00.000Z'),
('user_05','Elin User','elin.user@linksim.local','Terrain profile tester','','elin.user@linksim.local',1,'',1,NULL,NULL,NULL,NULL,NULL,0,0,1,'2026-03-08T08:40:00.000Z','admin_02','2026-03-08T08:40:00.000Z','2026-03-12T19:30:00.000Z'),
('user_06','Finn User','finn.user@linksim.local','Coverage QA','','finn.user@linksim.local',1,'',1,NULL,NULL,NULL,NULL,NULL,0,0,1,'2026-03-08T08:50:00.000Z','admin_02','2026-03-08T08:50:00.000Z','2026-03-12T19:30:00.000Z'),

-- Pending users
('pending_01','Grete Pending','grete.pending@linksim.local','Waiting approval','I need access for a municipal coverage project.','grete.pending@linksim.local',1,'',1,NULL,NULL,NULL,NULL,NULL,0,0,0,NULL,NULL,'2026-03-10T14:00:00.000Z','2026-03-12T19:30:00.000Z'),
('pending_02','Hans Pending','hans.pending@linksim.local','Waiting approval','I maintain emergency links in my area.','hans.pending@linksim.local',1,'',1,NULL,NULL,NULL,NULL,NULL,0,0,0,NULL,NULL,'2026-03-10T14:05:00.000Z','2026-03-12T19:30:00.000Z'),

-- Revoked users
('revoked_01','Iris Revoked','iris.revoked@linksim.local','Previously approved, now revoked','','iris.revoked@linksim.local',1,'',1,NULL,NULL,NULL,NULL,NULL,0,0,0,'2026-03-09T12:00:00.000Z','revoked:admin_02','2026-03-09T12:00:00.000Z','2026-03-12T19:30:00.000Z'),
('revoked_02','Jon Revoked','jon.revoked@linksim.local','Previously approved, now revoked','','jon.revoked@linksim.local',1,'',1,NULL,NULL,NULL,NULL,NULL,0,0,0,'2026-03-09T12:10:00.000Z','revoked:mod_01','2026-03-09T12:10:00.000Z','2026-03-12T19:30:00.000Z');
