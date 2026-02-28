CREATE TABLE "security_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" varchar(50) NOT NULL,
	"severity" varchar(20) NOT NULL,
	"user_id" uuid,
	"ip_address" varchar(45),
	"user_agent" text,
	"resource" varchar(255),
	"details" jsonb,
	"trace_id" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_security_events_type" ON "security_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "idx_security_events_severity" ON "security_events" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "idx_security_events_user" ON "security_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_security_events_created" ON "security_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_security_events_ip" ON "security_events" USING btree ("ip_address");