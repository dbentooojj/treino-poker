ALTER TABLE "training_nodes" ALTER COLUMN "training_type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "training_nodes" ADD COLUMN "decision_eligible" boolean DEFAULT true NOT NULL;