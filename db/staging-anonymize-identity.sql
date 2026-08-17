-- Run only after a staging refresh imported both identity lifecycle tables.
-- The temporary two-phase keys avoid primary-key collisions while preserving
-- distinct aliases and the canonical user/subject/claim relationship.
CREATE TEMP TABLE staging_identity_email_map (
  original_email TEXT PRIMARY KEY,
  temporary_email TEXT NOT NULL UNIQUE,
  anonymized_email TEXT NOT NULL UNIQUE
);

INSERT INTO staging_identity_email_map
  (original_email, temporary_email, anonymized_email)
SELECT normalized_email,
       '__linksim_staging_identity_' || printf('%016x', rowid),
       'staging+identity-' || printf('%016x', rowid) || '@example.invalid'
FROM verified_identity_claims;

-- The ordinary staging anonymizer has already replaced users.idp_email.
-- Restore lifecycle consistency from the subject's primary verified claim.
UPDATE users
SET idp_email = (
  SELECT mapping.anonymized_email
  FROM identity_subject_states subject
  JOIN staging_identity_email_map mapping
    ON mapping.original_email = subject.normalized_email
  WHERE subject.user_id = users.id AND subject.status = 'current'
)
WHERE idp_email_verified = 1
  AND EXISTS (
    SELECT 1
    FROM identity_subject_states subject
    JOIN staging_identity_email_map mapping
      ON mapping.original_email = subject.normalized_email
    WHERE subject.user_id = users.id AND subject.status = 'current'
  );

UPDATE identity_subject_states
SET normalized_email = COALESCE(
  (SELECT anonymized_email FROM staging_identity_email_map
   WHERE original_email = identity_subject_states.normalized_email),
  'staging+subject-' || printf('%016x', rowid) || '@example.invalid'
)
WHERE normalized_email IS NOT NULL AND trim(normalized_email) <> '';

UPDATE verified_identity_claims
SET normalized_email = (
  SELECT temporary_email FROM staging_identity_email_map
  WHERE original_email = verified_identity_claims.normalized_email
);

UPDATE verified_identity_claims
SET normalized_email = (
  SELECT anonymized_email FROM staging_identity_email_map
  WHERE temporary_email = verified_identity_claims.normalized_email
);

DROP TABLE staging_identity_email_map;
