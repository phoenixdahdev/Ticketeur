CREATE TABLE "form_fields" (
	"id" text PRIMARY KEY NOT NULL,
	"form_id" text NOT NULL,
	"label" text NOT NULL,
	"help_text" text DEFAULT '' NOT NULL,
	"type" text NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"options_json" jsonb,
	"position" integer DEFAULT 0 NOT NULL,
	"max_length" integer,
	"min_value" double precision,
	"max_value" double precision,
	"accepted_file_types" jsonb,
	"max_files" integer
);
--> statement-breakpoint
CREATE TABLE "form_price_options" (
	"id" text PRIMARY KEY NOT NULL,
	"form_id" text NOT NULL,
	"name" text NOT NULL,
	"price_minor" integer NOT NULL,
	"quantity_limit" integer,
	"claimed" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forms" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"type" text DEFAULT 'other' NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"slug" text NOT NULL,
	"opens_at" timestamp,
	"closes_at" timestamp,
	"capacity" integer,
	"claimed" integer DEFAULT 0 NOT NULL,
	"review_mode" text DEFAULT 'manual' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "forms_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"form_id" text NOT NULL,
	"price_option_id" text,
	"order_id" text,
	"applicant_id" text,
	"applicant_name" text NOT NULL,
	"applicant_email" text NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"answers_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reviewer_id" text,
	"reviewed_at" timestamp,
	"reason" text,
	"reference" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "submissions_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "type" text DEFAULT 'ticket' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "reference_id" text;--> statement-breakpoint
ALTER TABLE "form_fields" ADD CONSTRAINT "form_fields_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "form_price_options" ADD CONSTRAINT "form_price_options_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_price_option_id_form_price_options_id_fk" FOREIGN KEY ("price_option_id") REFERENCES "public"."form_price_options"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_applicant_id_user_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_reviewer_id_user_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "form_fields_form_idx" ON "form_fields" USING btree ("form_id","position");--> statement-breakpoint
CREATE INDEX "form_price_options_form_idx" ON "form_price_options" USING btree ("form_id");--> statement-breakpoint
CREATE INDEX "forms_event_idx" ON "forms" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "submissions_form_status_idx" ON "submissions" USING btree ("form_id","status");--> statement-breakpoint
CREATE INDEX "submissions_order_idx" ON "submissions" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "submissions_price_option_idx" ON "submissions" USING btree ("price_option_id");--> statement-breakpoint
CREATE INDEX "orders_reference_idx" ON "orders" USING btree ("type","reference_id");