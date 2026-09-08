-- CreateTable
CREATE TABLE "_scaffold_probe" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "_scaffold_probe_pkey" PRIMARY KEY ("id")
);
