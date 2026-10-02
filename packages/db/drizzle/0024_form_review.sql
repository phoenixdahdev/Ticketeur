ALTER TABLE "forms" ADD COLUMN "content_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "forms" ADD COLUMN "approved_revision" integer;--> statement-breakpoint
ALTER TABLE "forms" ADD COLUMN "review_requested_at" timestamp;--> statement-breakpoint
ALTER TABLE "forms" ADD COLUMN "reviewer_id" text;--> statement-breakpoint
ALTER TABLE "forms" ADD COLUMN "reviewed_at" timestamp;--> statement-breakpoint
ALTER TABLE "forms" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_reviewer_id_user_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "forms_status_idx" ON "forms" USING btree ("status");