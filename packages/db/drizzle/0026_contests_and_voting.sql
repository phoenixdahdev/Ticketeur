CREATE TABLE "contest_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"contest_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contests" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"slug" text NOT NULL,
	"voting_opens_at" timestamp,
	"voting_closes_at" timestamp,
	"nominations_open_at" timestamp,
	"nominations_close_at" timestamp,
	"free_voting_enabled" boolean DEFAULT true NOT NULL,
	"paid_voting_enabled" boolean DEFAULT true NOT NULL,
	"price_per_vote_minor" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"content_revision" integer DEFAULT 0 NOT NULL,
	"approved_revision" integer,
	"review_requested_at" timestamp,
	"reviewer_id" text,
	"reviewed_at" timestamp,
	"rejection_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "contests_slug_unique" UNIQUE("slug"),
	CONSTRAINT "contests_price_per_vote_non_negative" CHECK ("contests"."price_per_vote_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "entries" (
	"id" text PRIMARY KEY NOT NULL,
	"contest_id" text NOT NULL,
	"category_id" text NOT NULL,
	"submission_id" text,
	"display_name" text NOT NULL,
	"photo_url" text,
	"bio" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"vote_count" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "entries_vote_count_non_negative" CHECK ("entries"."vote_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "nominations" (
	"id" text PRIMARY KEY NOT NULL,
	"contest_id" text NOT NULL,
	"category_id" text NOT NULL,
	"nominee_name" text NOT NULL,
	"nominee_email" text,
	"nominee_phone" text,
	"reason" text DEFAULT '' NOT NULL,
	"nominated_by_email" text NOT NULL,
	"nominated_by_user_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"entry_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vote_bundles" (
	"id" text PRIMARY KEY NOT NULL,
	"contest_id" text NOT NULL,
	"label" text NOT NULL,
	"votes" integer NOT NULL,
	"price_minor" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "vote_bundles_votes_positive" CHECK ("vote_bundles"."votes" > 0),
	CONSTRAINT "vote_bundles_price_non_negative" CHECK ("vote_bundles"."price_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "vote_credits" (
	"id" text PRIMARY KEY NOT NULL,
	"contest_id" text NOT NULL,
	"voter_email" text NOT NULL,
	"voter_user_id" text,
	"purchased" integer DEFAULT 0 NOT NULL,
	"spent" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "vote_credits_purchased_non_negative" CHECK ("vote_credits"."purchased" >= 0),
	CONSTRAINT "vote_credits_spent_non_negative" CHECK ("vote_credits"."spent" >= 0),
	CONSTRAINT "vote_credits_not_overspent" CHECK ("vote_credits"."spent" <= "vote_credits"."purchased")
);
--> statement-breakpoint
CREATE TABLE "vote_otps" (
	"id" text PRIMARY KEY NOT NULL,
	"contest_id" text NOT NULL,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"consumed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "vote_otps_attempts_non_negative" CHECK ("vote_otps"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "votes" (
	"id" text PRIMARY KEY NOT NULL,
	"contest_id" text NOT NULL,
	"category_id" text NOT NULL,
	"entry_id" text NOT NULL,
	"kind" text NOT NULL,
	"voter_email" text NOT NULL,
	"voter_user_id" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"order_id" text,
	"voted_on" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "votes_quantity_positive" CHECK ("votes"."quantity" > 0)
);
--> statement-breakpoint
ALTER TABLE "contest_categories" ADD CONSTRAINT "contest_categories_contest_id_contests_id_fk" FOREIGN KEY ("contest_id") REFERENCES "public"."contests"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "contests" ADD CONSTRAINT "contests_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "contests" ADD CONSTRAINT "contests_reviewer_id_user_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_contest_id_contests_id_fk" FOREIGN KEY ("contest_id") REFERENCES "public"."contests"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_category_id_contest_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."contest_categories"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "nominations" ADD CONSTRAINT "nominations_contest_id_contests_id_fk" FOREIGN KEY ("contest_id") REFERENCES "public"."contests"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "nominations" ADD CONSTRAINT "nominations_category_id_contest_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."contest_categories"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "nominations" ADD CONSTRAINT "nominations_nominated_by_user_id_user_id_fk" FOREIGN KEY ("nominated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "vote_bundles" ADD CONSTRAINT "vote_bundles_contest_id_contests_id_fk" FOREIGN KEY ("contest_id") REFERENCES "public"."contests"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "vote_credits" ADD CONSTRAINT "vote_credits_contest_id_contests_id_fk" FOREIGN KEY ("contest_id") REFERENCES "public"."contests"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "vote_credits" ADD CONSTRAINT "vote_credits_voter_user_id_user_id_fk" FOREIGN KEY ("voter_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "vote_otps" ADD CONSTRAINT "vote_otps_contest_id_contests_id_fk" FOREIGN KEY ("contest_id") REFERENCES "public"."contests"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_contest_id_contests_id_fk" FOREIGN KEY ("contest_id") REFERENCES "public"."contests"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_category_id_contest_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."contest_categories"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_voter_user_id_user_id_fk" FOREIGN KEY ("voter_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "contest_categories_contest_idx" ON "contest_categories" USING btree ("contest_id");--> statement-breakpoint
CREATE INDEX "contests_event_idx" ON "contests" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "contests_status_idx" ON "contests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "entries_category_idx" ON "entries" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "entries_contest_idx" ON "entries" USING btree ("contest_id");--> statement-breakpoint
CREATE INDEX "entries_leaderboard_idx" ON "entries" USING btree ("category_id","vote_count");--> statement-breakpoint
CREATE UNIQUE INDEX "entries_submission_unique" ON "entries" USING btree ("contest_id","submission_id") WHERE "entries"."submission_id" is not null;--> statement-breakpoint
CREATE INDEX "nominations_contest_idx" ON "nominations" USING btree ("contest_id","status");--> statement-breakpoint
CREATE INDEX "nominations_category_idx" ON "nominations" USING btree ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "nominations_one_per_nominator_unique" ON "nominations" USING btree ("category_id","nominated_by_email","nominee_name");--> statement-breakpoint
CREATE INDEX "vote_bundles_contest_idx" ON "vote_bundles" USING btree ("contest_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vote_credits_owner_unique" ON "vote_credits" USING btree ("contest_id","voter_email");--> statement-breakpoint
CREATE INDEX "vote_otps_lookup_idx" ON "vote_otps" USING btree ("email","contest_id");--> statement-breakpoint
CREATE INDEX "vote_otps_expires_idx" ON "vote_otps" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "votes_entry_idx" ON "votes" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "votes_contest_idx" ON "votes" USING btree ("contest_id");--> statement-breakpoint
CREATE INDEX "votes_voter_idx" ON "votes" USING btree ("voter_email","contest_id");--> statement-breakpoint
CREATE UNIQUE INDEX "votes_free_daily_unique" ON "votes" USING btree ("category_id","voter_email","voted_on") WHERE "votes"."kind" = 'free';