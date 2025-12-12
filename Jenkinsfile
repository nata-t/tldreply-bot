/**
 * CORRECTED FINAL Declarative Pipeline.
 * Fixes syntax error by nesting the 'node' step inside the 'steps' block for each stage.
 */
pipeline {
    agent any

    environment {
        NODE_ENV = "production"
        PM2_APP_NAME = "trlreply-bot"
    }

    stages {
        // Stage 1: Dependency Installation
        stage('📦 Install Dependencies') {
            steps { // <--- CORRECT: The 'steps' block is mandatory
                node('node20') { 
                    echo '⬇️ Installing dependencies...'
                    sh 'npm ci' 
                }
            } // <--- END of 'steps'
        }

        // Stage 2: Code Quality Checks
        stage('🧪 Lint, Format, & Test (Parallel)') {
            steps { // <--- CORRECT: The 'steps' block is mandatory
                node('node20') { 
                    parallel {
                        // NOTE: 'parallel' contains 'stage' directives, which contain their own 'steps'
                        stage('Lint Check') { steps { sh 'npm run lint' } }
                        stage('Format Check') { steps { sh 'npm run format:check' } }
                    }
                }
            } // <--- END of 'steps'
        }

        // Stage 3: Build Application
        stage('🔨 Build Application') {
            steps { // <--- CORRECT: The 'steps' block is mandatory
                node('node20') { 
                    echo '🛠️ Compiling TypeScript...'
                    sh 'npm run build'
                }
            }
        }

        // Stage 4: Deploy Application
        stage('🚀 Deploy with PM2') {
            steps { // <--- CORRECT: The 'steps' block is mandatory
                node('node20') { 
                    echo "☁️ Deploying application: ${env.PM2_APP_NAME}"
                    
                    sh '''
                        pm2 describe $PM2_APP_NAME > /dev/null 2>&1
                        if [ $? -eq 0 ]; then pm2 delete $PM2_APP_NAME; fi
                    '''
                    sh "pm2 start dist/index.js --name $PM2_APP_NAME"
                    sh 'pm2 save'
                }
            }
        }
    }

    // Post-actions remain correct
    post {
        always {
            echo '🧹 Cleaning up workspace...'
            cleanWs() 
        }
        success {
            echo '🎉 SUCCESS! Pipeline completed successfully!'
        }
        failure {
            echo '❌ FAILED! Check the logs for errors.'
        }
    }
}