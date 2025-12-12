/**
 * FINAL Declarative Pipeline - Uses 'tools' directive for robust Node.js environment setup.
 */
pipeline {
    // Agent: Run the job on any available Jenkins agent.
    agent any 

    // FIX: Use the 'tools' directive to install and put the 'node20' tool in the PATH
    tools {
        // The name MUST match the configuration you set in Manage Jenkins -> Tools (image_e531be.png)
        nodejs 'node20' 
    }

    environment {

        PATH = "${env.PATH}:./node_modules/.bin"
        
        // These variables are fine
        NODE_ENV = "production"
        PM2_APP_NAME = "trlreply-bot"
    }

    stages {
        // Stage 1: Dependency Installation (Removed node('node20') wrapper)
        stage('📦 Install Dependencies') {
            steps {
                echo '⬇️ Installing dependencies...'
                // 'npm ci' will now work because 'nodejs 'node20'' set the PATH
                sh 'npm ci' 
            }
        }

        // Stage 2: Code Quality Checks (Simplified: removed node() and script() wrappers)
        stage('🧪 Lint, Format, & Test (Parallel)') {
            parallel { // Use the native Declarative parallel directive now
                stage('Lint Check') { 
                    steps { sh 'npm run lint' } // Works because Node.js is in PATH
                }
                stage('Format Check') { 
                    steps { sh 'npm run format:check' } 
                }
            }
        }

        // Stage 3: Build Application
        stage('🔨 Build Application') {
            steps {
                echo '🛠️ Compiling TypeScript...'
                sh 'npm run build'
            }
        }

        // Stage 4: Deploy Application
        stage('🚀 Deploy with PM2') {
            steps {
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